from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import logging

from concurrent.futures import ThreadPoolExecutor, as_completed

from indices import INDEX_NAMES, get_symbols
from scanner import scan_stocks, calculate_ema, calculate_avg_volume, TIMEFRAME_MAP
from rs_scanner import scan_rs_stocks, BENCHMARK_NAMES, BENCHMARK_MAP, _compute_ratio, _normalize_index, _rs_trend
from data_fetcher import fetch_ohlcv, SESSION
from indicators import compute_signals, compute_mtf_snapshot, compute_signal_history, compute_rating_history, rsi as calc_rsi
from index_scanner import fetch_chart_ohlcv
from database import init_db
from portfolio_routes import router as portfolio_router
from monitoring_routes import router as monitoring_router
from rules_routes import router as rules_router
from scheduler import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="NSE EMA Scanner", version="1.0.0")

init_db()
app.include_router(portfolio_router)
app.include_router(monitoring_router)
app.include_router(rules_router)


@app.on_event("startup")
def on_startup():
    start_scheduler()


@app.on_event("shutdown")
def on_shutdown():
    stop_scheduler()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScanRequest(BaseModel):
    indices: list[str] = Field(default=["NIFTY 50"])
    symbols: Optional[list[str]] = Field(default=None)  # scan an explicit list (e.g. a watchlist)
    timeframe: str = Field(default="daily")
    ema_period: int = Field(default=150)
    condition: str = Field(default="near_ema")
    distance_pct: float = Field(default=3.0)
    cross_lookback: int = Field(default=3)


@app.get("/api/indices")
def get_indices():
    return {"indices": INDEX_NAMES}


@app.get("/api/index-constituents")
def index_constituents(index: str):
    """Constituent stocks of an NSE index — powers the 'View Constituents' option
    on the Index Scanner cards. Returns [] with available=False for indices we
    don't have a constituent list for."""
    from index_constituents import get_constituents, is_representative

    cons = get_constituents(index)
    if cons is None:
        return {"index": index, "available": False, "count": 0, "constituents": [], "representative": False}
    return {
        "index": index,
        "available": True,
        "count": len(cons),
        "constituents": cons,
        "representative": is_representative(index),
    }


@app.get("/api/index-scan")
def index_scan(timeframe: str = "daily"):
    """Index Scanner dashboard: recent strong/weak sectors + a full table of
    every major NSE index with its EMA structure (20/50/150/200), technical
    score and trailing returns."""
    from index_scanner import build_dashboard

    if timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe: {timeframe}")
    return build_dashboard(timeframe)


@app.post("/api/scan")
def scan(req: ScanRequest):
    logger.info(f"Scan request: {req}")

    if req.timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe: {req.timeframe}")

    # An explicit symbol list (e.g. "Scan this watchlist") bypasses index lookup
    if req.symbols:
        symbols = [s.upper().strip().replace(" ", "") for s in req.symbols if s and s.strip()]
        if not symbols:
            raise HTTPException(status_code=400, detail="No valid symbols provided")
    else:
        valid = [i for i in req.indices if i in INDEX_NAMES]
        if not valid:
            raise HTTPException(status_code=400, detail="No valid indices provided")
        symbols = get_symbols(valid)
        if not symbols:
            raise HTTPException(status_code=400, detail="No symbols found for selected indices")

    logger.info(f"Scanning {len(symbols)} symbols...")

    results, no_data = scan_stocks(
        symbols=symbols,
        timeframe=req.timeframe,
        ema_period=req.ema_period,
        condition=req.condition,
        distance_pct=req.distance_pct,
        cross_lookback=req.cross_lookback,
    )

    return {
        "results": results,
        "scanned": len(symbols),
        "found": len(results),
        "noData": no_data,
        "analyzed": len(symbols) - len(no_data),
    }


class RSScanRequest(BaseModel):
    indices: list[str] = Field(default=["NIFTY 50"])
    symbols: Optional[list[str]] = Field(default=None)  # explicit list (e.g. watchlist)
    timeframe: str = Field(default="daily")
    benchmark: str = Field(default="NIFTY 50")
    ema_period: int = Field(default=150)
    rs_condition: str = Field(default="above_ema")
    distance_pct: float = Field(default=3.0)
    cross_lookback: int = Field(default=3)
    rs_trend_filter: str = Field(default="Any")
    price_condition: Optional[str] = Field(default=None)
    price_ema_period: int = Field(default=150)
    price_distance_pct: float = Field(default=3.0)


class EmaStatusRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list)
    timeframe: str = Field(default="daily")


@app.post("/api/ema-status")
def ema_status(req: EmaStatusRequest):
    """Multi-EMA (20/50/150/200) status for an explicit symbol list at a given
    timeframe — powers the Watchlist table so a user can compare a stock's EMA
    position across timeframes. Returns every symbol with data (no filtering)."""
    from scan_engine import fetch_all_ema_status

    if req.timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe: {req.timeframe}")
    symbols = [s.upper().strip().replace(" ", "") for s in req.symbols if s and s.strip()]
    if not symbols:
        return {"status": {}, "noData": []}

    status, no_data = fetch_all_ema_status(symbols, req.timeframe)
    return {"status": status, "noData": no_data}


@app.get("/api/benchmarks")
def get_benchmarks():
    return {"benchmarks": BENCHMARK_NAMES}


# Chart panel fetches MORE history than the scanner (independent ranges so
# scans stay fast) — these are the Yahoo `range` values used only by /api/chart.
# Capped at Yahoo's per-interval maximums (60d for sub-hourly, 730d for 1h).
_CHART_RANGE = {
    "5min":    "60d",   # Yahoo max for sub-hourly intervals
    "15min":   "60d",
    "30min":   "60d",
    "1h":      "2y",    # Yahoo's 60m limit is 730d; the "730d" token is rejected
                        # for stocks whose history predates it (clamps start to IPO,
                        # exceeding the window) — the standard "2y" token is safe.
    "daily":   "5y",
    "weekly":  "20y",   # NOT "max" — for long-listed stocks Yahoo silently
                        # downgrades a "1wk" interval request to monthly
                        # granularity once the range spans back to IPO. "20y"
                        # stays under that threshold (verified against RELIANCE,
                        # NSE's longest history) while still giving ~1000 bars.
    "monthly": "max",
}

# How many candles to show in the chart panel per timeframe.
# Generous windows so the chart isn't sparse; EMAs are computed on the full
# fetched history and only the display window is returned.
_CHART_DISPLAY_BARS = {
    "5min":    750,   # ~10 trading days
    "15min":   600,   # ~20 trading days
    "30min":   500,   # ~35 trading days
    "1h":      1000,  # ~160 trading days
    "daily":   1300,  # ~5 years
    "weekly":  800,   # full available history
    "monthly": 360,   # full available history
}


@app.get("/api/chart/{symbol}")
def get_chart(symbol: str, timeframe: str = "daily", benchmark: str = "NIFTY 50"):
    import pandas as pd

    if timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe: {timeframe}")

    interval, _scan_period = TIMEFRAME_MAP[timeframe]
    # Use the chart's own (longer) range so the panel shows more history
    period = _CHART_RANGE.get(timeframe, _scan_period)
    df = fetch_chart_ohlcv(symbol, interval, period)
    if df is None or len(df) < 20:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")

    # Compute price EMAs on full history; display only the last N bars
    n_display = _CHART_DISPLAY_BARS.get(timeframe, 200)
    ema20_s  = calculate_ema(df["Close"], 20)
    ema50_s  = calculate_ema(df["Close"], 50)
    ema150_s = calculate_ema(df["Close"], 150)

    display_df  = df.tail(n_display)
    ema20_disp  = ema20_s.tail(n_display)
    ema50_disp  = ema50_s.tail(n_display)
    ema150_disp = ema150_s.tail(n_display)

    is_daily_or_longer = interval in ("1d", "1wk", "1mo")

    def to_time(ts):
        return ts.strftime("%Y-%m-%d") if is_daily_or_longer else int(ts.timestamp())

    candles = [
        {
            "time":  to_time(idx),
            "open":  round(float(row["Open"]),  2),
            "high":  round(float(row["High"]),  2),
            "low":   round(float(row["Low"]),   2),
            "close": round(float(row["Close"]), 2),
        }
        for idx, row in display_df.iterrows()
    ]

    def ema_series(s):
        return [
            {"time": to_time(idx), "value": round(float(v), 2)}
            for idx, v in s.items()
            if not pd.isna(v)
        ]

    # ── Ratio pane data + conditions vs selected benchmark ───────────────────
    ratio_conditions = None
    ratio_line_data  = None
    ratio_ema20_data = None
    ratio_ema150_data = None

    bench_yahoo = BENCHMARK_MAP.get(benchmark)
    if bench_yahoo:
        bench_df = fetch_ohlcv(bench_yahoo, interval, period)
        if bench_df is not None:
            ratio = _compute_ratio(df, bench_df, interval)
            if ratio is not None and len(ratio) >= 20:
                cur = float(ratio.iloc[-1])

                # Conditions
                ratio_conditions = {}
                for p in (20, 50, 150):
                    if len(ratio) >= p:
                        ema_v = float(calculate_ema(ratio, p).iloc[-1])
                        if ema_v != 0:
                            dist = (cur - ema_v) / ema_v * 100
                            ratio_conditions[f"ema{p}"] = {
                                "above": bool(cur > ema_v),
                                "dist":  round(dist, 2),
                            }

                # Line series for lower pane — same display window as price chart
                def ratio_series(s):
                    return [
                        {"time": to_time(idx), "value": round(float(v), 8)}
                        for idx, v in s.items()
                        if not pd.isna(v)
                    ]

                r_display = ratio.tail(n_display)
                ratio_line_data = ratio_series(r_display)

                r_ema20_full = calculate_ema(ratio, 20)
                ratio_ema20_data = ratio_series(r_ema20_full.tail(n_display))

                if len(ratio) >= 150:
                    r_ema150_full = calculate_ema(ratio, 150)
                    ratio_ema150_data = ratio_series(r_ema150_full.tail(n_display))

    # ── MACD(12,26,9) pane ─────────────────────────────────────────────────────
    macd_line_data = macd_signal_data = macd_hist_data = None
    try:
        from indicators import macd as compute_macd
        macd_l, sig_l = compute_macd(df["Close"], fast=12, slow=26, sig=9)
        hist_s = macd_l - sig_l
        # Align to the same display window as the candles
        idx_set = {to_time(i) for i in display_df.index}

        def _macd_series(s):
            return [
                {"time": to_time(idx), "value": round(float(v), 6)}
                for idx, v in s.items()
                if not pd.isna(v) and to_time(idx) in idx_set
            ]

        def _hist_series(s):
            return [
                {
                    "time":  to_time(idx),
                    "value": round(float(v), 6),
                    "color": "#26a69a" if v >= 0 else "#ef5350",
                }
                for idx, v in s.items()
                if not pd.isna(v) and to_time(idx) in idx_set
            ]

        macd_line_data   = _macd_series(macd_l)
        macd_signal_data = _macd_series(sig_l)
        macd_hist_data   = _hist_series(hist_s)
    except Exception:
        pass

    return {
        "symbol":          symbol,
        "timeframe":       timeframe,
        "benchmark":       benchmark,
        "candles":         candles,
        "ema20":           ema_series(ema20_disp),
        "ema50":           ema_series(ema50_disp),
        "ema150":          ema_series(ema150_disp),
        "macdLine":        macd_line_data,
        "macdSignal":      macd_signal_data,
        "macdHistogram":   macd_hist_data,
        "ratioConditions": ratio_conditions,
        "ratioLine":       ratio_line_data,
        "ratioEma20":      ratio_ema20_data,
        "ratioEma150":     ratio_ema150_data,
    }


@app.post("/api/rs-scan")
def rs_scan(req: RSScanRequest):
    logger.info(f"RS Scan request: {req}")

    if req.symbols:
        symbols = [s.upper().strip().replace(" ", "") for s in req.symbols if s and s.strip()]
        if not symbols:
            raise HTTPException(status_code=400, detail="No valid symbols provided")
    else:
        valid = [i for i in req.indices if i in INDEX_NAMES]
        if not valid:
            raise HTTPException(status_code=400, detail="No valid indices provided")
        symbols = get_symbols(valid)
        if not symbols:
            raise HTTPException(status_code=400, detail="No symbols found for selected indices")

    logger.info(f"RS scanning {len(symbols)} symbols vs {req.benchmark}...")

    try:
        results, no_data = scan_rs_stocks(
            symbols=symbols,
            benchmark=req.benchmark,
            timeframe=req.timeframe,
            ema_period=req.ema_period,
            rs_condition=req.rs_condition,
            distance_pct=req.distance_pct,
            cross_lookback=req.cross_lookback,
            rs_trend_filter=req.rs_trend_filter,
            price_condition=req.price_condition,
            price_ema_period=req.price_ema_period,
            price_distance_pct=req.price_distance_pct,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "results": results,
        "scanned": len(symbols),
        "found": len(results),
        "noData": no_data,
        "analyzed": len(symbols) - len(no_data),
    }


@app.get("/api/signals/{symbol}")
def get_signals(symbol: str, timeframe: str = "daily", benchmark: str = "NIFTY 50"):
    """Compute full 10-13 condition signal panel for a single symbol.
    Used by Portfolio Guardian when opening the stock detail panel.
    """
    if timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe: {timeframe}")
    interval, period = TIMEFRAME_MAP[timeframe]
    df = fetch_chart_ohlcv(symbol, interval, period)
    if df is None or len(df) < 30:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")

    # Optionally compute ratio for conditions 11-13
    ratio = None
    bench_yahoo = BENCHMARK_MAP.get(benchmark)
    if bench_yahoo:
        bench_df = fetch_ohlcv(bench_yahoo, interval, period)
        if bench_df is not None:
            ratio = _compute_ratio(df, bench_df, interval)

    return compute_signals(df, ratio)


# ── Multi-timeframe matrix ───────────────────────────────────────────────────

_MTF_TIMEFRAMES = ["5min", "15min", "30min", "1h", "daily", "weekly", "monthly"]
_MTF_LABELS = {"5min": "5m", "15min": "15m", "30min": "30m", "1h": "1H",
               "daily": "D", "weekly": "W", "monthly": "M"}


@app.get("/api/mtf-matrix/{symbol}")
def mtf_matrix(symbol: str, benchmark: str = "NIFTY 50"):
    """One column per timeframe (5m..monthly), 8 indicator rows each — powers
    the multi-timeframe matrix in the chart panel sidebar."""
    bench_yahoo = BENCHMARK_MAP.get(benchmark)

    def build_column(tf):
        interval, scan_period = TIMEFRAME_MAP[tf]
        period = _CHART_RANGE.get(tf, scan_period)
        df = fetch_chart_ohlcv(symbol, interval, period)
        if df is None or len(df) < 30:
            return {"timeframe": tf, "label": _MTF_LABELS[tf], "available": False}

        ratio = None
        if bench_yahoo:
            bench_df = fetch_ohlcv(bench_yahoo, interval, period)
            if bench_df is not None:
                ratio = _compute_ratio(df, bench_df, interval)

        snap = compute_mtf_snapshot(df, ratio)
        snap["timeframe"] = tf
        snap["label"] = _MTF_LABELS[tf]
        snap["available"] = True
        return snap

    columns = []
    with ThreadPoolExecutor(max_workers=len(_MTF_TIMEFRAMES)) as executor:
        futures = {executor.submit(build_column, tf): tf for tf in _MTF_TIMEFRAMES}
        results_by_tf = {}
        for future in as_completed(futures):
            tf = futures[future]
            try:
                results_by_tf[tf] = future.result()
            except Exception:
                results_by_tf[tf] = {"timeframe": tf, "label": _MTF_LABELS[tf], "available": False}
    columns = [results_by_tf[tf] for tf in _MTF_TIMEFRAMES]

    total_bull = sum(c.get("bullCount", 0) for c in columns if c.get("available"))
    total_ind  = sum(c.get("total", 0) for c in columns if c.get("available"))

    return {
        "symbol": symbol,
        "benchmark": benchmark,
        "columns": columns,
        "totalBull": total_bull,
        "totalIndicators": total_ind,
    }


# ── Signal history (derived crossover events) ───────────────────────────────

@app.get("/api/signal-history/{symbol}")
def signal_history(symbol: str, timeframe: str = "daily", benchmark: str = "NIFTY 50",
                    days: int = 120, limit: int = 20):
    if timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe: {timeframe}")
    interval, scan_period = TIMEFRAME_MAP[timeframe]
    period = _CHART_RANGE.get(timeframe, scan_period)
    df = fetch_chart_ohlcv(symbol, interval, period)
    if df is None or len(df) < 30:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")

    ratio = None
    bench_yahoo = BENCHMARK_MAP.get(benchmark)
    if bench_yahoo:
        bench_df = fetch_ohlcv(bench_yahoo, interval, period)
        if bench_df is not None:
            ratio = _compute_ratio(df, bench_df, interval)

    events = compute_signal_history(df, ratio, lookback_days=days, max_events=limit)
    return {"symbol": symbol, "timeframe": timeframe, "events": events}


# ── Rating history (walk-forward score) ─────────────────────────────────────

@app.get("/api/rating-history/{symbol}")
def rating_history(symbol: str, timeframe: str = "daily", benchmark: str = "NIFTY 50", days: int = 20):
    if timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe: {timeframe}")
    interval, scan_period = TIMEFRAME_MAP[timeframe]
    period = _CHART_RANGE.get(timeframe, scan_period)
    df = fetch_chart_ohlcv(symbol, interval, period)
    if df is None or len(df) < 30:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")

    ratio = None
    bench_yahoo = BENCHMARK_MAP.get(benchmark)
    if bench_yahoo:
        bench_df = fetch_ohlcv(bench_yahoo, interval, period)
        if bench_df is not None:
            ratio = _compute_ratio(df, bench_df, interval)

    history = compute_rating_history(df, ratio, days=days)
    return {"symbol": symbol, "timeframe": timeframe, "history": history}


# ── Rating Screener (rating shifts / big score moves, daily only) ───────────

class RatingScanRequest(BaseModel):
    indices: list[str] = Field(default=["NIFTY 50"])
    symbols: Optional[list[str]] = Field(default=None)  # explicit list (e.g. watchlist)
    benchmark: str = Field(default="NIFTY 50")
    lookback_days: int = Field(default=1, ge=1, le=10)
    move_threshold: float = Field(default=20.0, ge=5.0, le=100.0)


@app.post("/api/rating-scan")
def rating_scan(req: RatingScanRequest):
    """Rating Screener: stocks whose walk-forward Rating History score changed
    bucket (e.g. Hold → Buy) or moved ≥ threshold points within the last N
    trading days. Daily timeframe only."""
    from rating_screener import scan_rating_shifts

    logger.info(f"Rating scan request: {req}")

    if req.symbols:
        symbols = [s.upper().strip().replace(" ", "") for s in req.symbols if s and s.strip()]
        if not symbols:
            raise HTTPException(status_code=400, detail="No valid symbols provided")
    else:
        valid = [i for i in req.indices if i in INDEX_NAMES]
        if not valid:
            raise HTTPException(status_code=400, detail="No valid indices provided")
        symbols = get_symbols(valid)
        if not symbols:
            raise HTTPException(status_code=400, detail="No symbols found for selected indices")

    logger.info(f"Rating-scanning {len(symbols)} symbols...")

    results, no_data = scan_rating_shifts(
        symbols=symbols,
        benchmark=req.benchmark,
        lookback_days=req.lookback_days,
        move_threshold=req.move_threshold,
    )

    return {
        "results": results,
        "scanned": len(symbols),
        "found": len(results),
        "noData": no_data,
        "analyzed": len(symbols) - len(no_data),
    }


# ── Breakout Screener (150-EMA reclaim + swing-high break, daily only) ──────

class BreakoutScanRequest(BaseModel):
    indices: list[str] = Field(default=["NIFTY 50"])
    symbols: Optional[list[str]] = Field(default=None)  # explicit list (e.g. watchlist)
    benchmark: str = Field(default="NIFTY 50")
    timeframe: str = Field(default="daily")
    swing_period: int = Field(default=10, ge=3, le=50)
    cross_window: int = Field(default=30, ge=5, le=120)
    lookback_bars: int = Field(default=10, ge=1, le=30)


@app.post("/api/breakout-scan")
def breakout_scan(req: BreakoutScanRequest):
    """Breakout Screener: stocks whose close (and/or ratio vs the benchmark)
    crossed above its 150 EMA within `cross_window` bars and then closed above
    the prior `swing_period`-bar high, within the last `lookback_bars` bars of
    the chosen timeframe."""
    from breakout_screener import scan_breakouts

    logger.info(f"Breakout scan request: {req}")

    if req.timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe: {req.timeframe}")

    if req.symbols:
        symbols = [s.upper().strip().replace(" ", "") for s in req.symbols if s and s.strip()]
        if not symbols:
            raise HTTPException(status_code=400, detail="No valid symbols provided")
    else:
        valid = [i for i in req.indices if i in INDEX_NAMES]
        if not valid:
            raise HTTPException(status_code=400, detail="No valid indices provided")
        symbols = get_symbols(valid)
        if not symbols:
            raise HTTPException(status_code=400, detail="No symbols found for selected indices")

    logger.info(f"Breakout-scanning {len(symbols)} symbols...")

    results, no_data = scan_breakouts(
        symbols=symbols,
        benchmark=req.benchmark,
        timeframe=req.timeframe,
        swing_period=req.swing_period,
        cross_window=req.cross_window,
        lookback_bars=req.lookback_bars,
    )

    return {
        "results": results,
        "scanned": len(symbols),
        "found": len(results),
        "noData": no_data,
        "analyzed": len(symbols) - len(no_data),
    }


# ── Compare stocks ───────────────────────────────────────────────────────────

@app.get("/api/compare-snapshot/{symbol}")
def compare_snapshot(symbol: str, timeframe: str = "daily", benchmark: str = "NIFTY 50"):
    """Single-symbol snapshot for the Compare Stocks tool: price, technical
    score, RS trend, EMA structure, MACD, volume, RSI."""
    if timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe: {timeframe}")
    interval, scan_period = TIMEFRAME_MAP[timeframe]
    period = _CHART_RANGE.get(timeframe, scan_period)
    df = fetch_chart_ohlcv(symbol, interval, period)
    if df is None or len(df) < 30:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")

    ratio = None
    rs_trend = "Unknown"
    ratio_dist = None
    bench_yahoo = BENCHMARK_MAP.get(benchmark)
    if bench_yahoo:
        bench_df = fetch_ohlcv(bench_yahoo, interval, period)
        if bench_df is not None:
            ratio = _compute_ratio(df, bench_df, interval)
            if ratio is not None and len(ratio) >= 20:
                r_ema = calculate_ema(ratio, 20)
                rs_trend = _rs_trend(r_ema)
                r_cur, r_ema_v = float(ratio.iloc[-1]), float(r_ema.iloc[-1])
                if r_ema_v != 0:
                    ratio_dist = round((r_cur - r_ema_v) / r_ema_v * 100, 2)

    signals = compute_signals(df, ratio)
    conds = signals["conditions"]

    ema_flags = [conds[k]["bull"] for k in ("price_gt_20ema", "price_gt_50ema", "price_gt_150ema") if k in conds]
    ema_structure = "All above" if all(ema_flags) else ("All below" if not any(ema_flags) else "Mixed")

    # Per-EMA breakout so the Compare tool can show 20/50/150 detail rows for
    # both price-vs-EMA and ratio-vs-EMA. bull is None (→ "—" in the UI) when the
    # indicator wasn't computed, e.g. ratio rows with no benchmark ratio.
    def _bull(key):
        c = conds.get(key)
        return c["bull"] if c else None

    avg_vol = calculate_avg_volume(df["Volume"])
    cur_vol = float(df["Volume"].iloc[-1])
    rsi_val = float(calc_rsi(df["Close"], 14).iloc[-1])

    return {
        "symbol":        symbol,
        "ltp":           round(float(df["Close"].iloc[-1]), 2),
        "score":         signals["pct"],
        "signal":        signals["signal"],
        "rsTrend":       rs_trend,
        "ratioDistance": ratio_dist,
        "emaStructure":  ema_structure,
        "priceVs20":     _bull("price_gt_20ema"),
        "priceVs50":     _bull("price_gt_50ema"),
        "priceVs150":    _bull("price_gt_150ema"),
        "ratioVs20":     _bull("ratio_gt_20ema"),
        "ratioVs50":     _bull("ratio_gt_50ema"),
        "ratioVs150":    _bull("ratio_gt_150ema"),
        "macdBullish":   conds.get("macd_gt_signal", {}).get("bull"),
        "volume":        int(cur_vol),
        "avgVolume":     int(avg_vol),
        "volRatio":      round(cur_vol / avg_vol, 2) if avg_vol else None,
        "rsi":           round(rsi_val, 1),
    }


# Full curated NSE universe (~500 symbols) the scanner can analyze, with company
# names. Yahoo's search endpoint fails to surface some valid NSE tickers — notably
# ampersand names like M&M and ARE&M — so we match against the local universe by
# BOTH ticker and company name to guarantee search/scanner parity: anything
# scannable is also findable, whether the user types "M&M" or "mahindra".
from symbol_names import SYMBOL_NAMES
_CURATED_SYMBOLS = sorted(set(get_symbols(INDEX_NAMES)))


@app.get("/api/search-symbols")
def search_symbols(q: str = ""):
    """Free-text symbol search across NSE-listed equities. Combines the local
    curated universe (matched by ticker AND company name — guarantees every
    scannable stock is findable, incl. M&M etc.) with Yahoo's search endpoint
    (fills in stocks outside the curated list). Powers the Compare Stocks picker
    and the Search Charts module."""
    q = q.strip()
    if len(q) < 1:
        return {"results": []}

    # Local matches first — highest confidence (NSE + scanner-supported).
    # Rank: ticker prefix > name prefix > ticker/name substring.
    qu = q.upper()
    tick_prefix, name_prefix, substr = [], [], []
    for s in _CURATED_SYMBOLS:
        name = SYMBOL_NAMES.get(s, s)
        nu = name.upper()
        if s.startswith(qu):
            tick_prefix.append(s)
        elif nu.startswith(qu):
            name_prefix.append(s)
        elif qu in s or qu in nu:
            substr.append(s)

    seen = set()
    results = []
    for sym in tick_prefix + name_prefix + substr:
        if sym in seen:
            continue
        seen.add(sym)
        results.append({"symbol": sym, "name": SYMBOL_NAMES.get(sym, sym)})

    # Yahoo results (fills in company-name matches and stocks outside the
    # curated list), skipping any ticker already surfaced locally.
    try:
        resp = SESSION.get(
            "https://query1.finance.yahoo.com/v1/finance/search",
            params={"q": q, "quotesCount": 15, "newsCount": 0},
            timeout=8,
        )
        data = resp.json() if resp.status_code == 200 else {}
    except Exception:
        data = {}

    for item in data.get("quotes", []):
        sym = item.get("symbol", "")
        if not sym.endswith(".NS"):
            continue
        base = sym[:-3]
        if base in seen:
            continue
        seen.add(base)
        results.append({
            "symbol": base,
            "name": item.get("shortname") or item.get("longname") or base,
        })

    return {"results": results[:20]}


@app.get("/api/financials/{symbol}")
def get_financials(symbol: str):
    """Quarterly Sales/EPS with YoY %Chg for the Financial Scan panel —
    scraped from screener.in since Yahoo's fundamentals API only exposes
    ~4-5 trailing quarters for NSE stocks (confirmed too shallow for this)."""
    from fundamentals import fetch_quarterly_financials

    data = fetch_quarterly_financials(symbol)
    if not data:
        raise HTTPException(status_code=404, detail=f"No quarterly financials found for {symbol}")
    return data


@app.get("/api/data-health")
def data_health(scope: str = "quick"):
    """Data-quality sweep over the curated universe.
    scope=quick → daily timeframe only (~500 fetches, fast sanity check).
    scope=full  → all 7 timeframes (~3500 fetches, several minutes)."""
    from data_health import run_health_sweep

    if scope not in ("quick", "full"):
        raise HTTPException(status_code=400, detail="scope must be 'quick' or 'full'")
    timeframes = None if scope == "full" else ["daily"]
    return run_health_sweep(timeframes=timeframes)


@app.get("/health")
def health():
    return {"status": "ok"}


# ── Static frontend ──────────────────────────────────────────────────────────
# When frontend/dist exists (production / Docker), this one FastAPI process
# serves the whole product: API routes above win, everything else falls through
# to the built React app. In development the Vite dev server (5173) is used
# instead and this mount simply never matches anything the frontend requests.
from pathlib import Path
from fastapi.staticfiles import StaticFiles

_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")
