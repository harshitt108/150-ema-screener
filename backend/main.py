from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import logging

from indices import INDEX_NAMES, get_symbols
from scanner import scan_stocks, calculate_ema, TIMEFRAME_MAP
from rs_scanner import scan_rs_stocks, BENCHMARK_NAMES, BENCHMARK_MAP, _compute_ratio, _normalize_index
from data_fetcher import fetch_ohlcv

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="NSE EMA Scanner", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScanRequest(BaseModel):
    indices: list[str] = Field(default=["NIFTY 50"])
    timeframe: str = Field(default="daily")
    ema_period: int = Field(default=150)
    condition: str = Field(default="near_ema")
    distance_pct: float = Field(default=3.0)
    cross_lookback: int = Field(default=3)


@app.get("/api/indices")
def get_indices():
    return {"indices": INDEX_NAMES}


@app.post("/api/scan")
def scan(req: ScanRequest):
    logger.info(f"Scan request: {req}")

    # Validate indices
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


@app.get("/api/benchmarks")
def get_benchmarks():
    return {"benchmarks": BENCHMARK_NAMES}


# How many candles to show in the chart panel per timeframe
_CHART_DISPLAY_BARS = {
    "5min":    200,   # ~1.5 trading days
    "15min":   300,   # ~10 trading days
    "30min":   300,   # ~20 trading days
    "1h":      500,   # ~80 trading days (~4 months)
    "2h":      400,
    "4h":      300,
    "daily":   500,   # ~2 years
    "weekly":  260,   # ~5 years
    "monthly": 120,   # ~10 years
}


@app.get("/api/chart/{symbol}")
def get_chart(symbol: str, timeframe: str = "daily", benchmark: str = "NIFTY 50"):
    import pandas as pd

    if timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe: {timeframe}")

    interval, period = TIMEFRAME_MAP[timeframe]
    df = fetch_ohlcv(f"{symbol}.NS", interval, period)
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

    return {
        "symbol":          symbol,
        "timeframe":       timeframe,
        "benchmark":       benchmark,
        "candles":         candles,
        "ema20":           ema_series(ema20_disp),
        "ema50":           ema_series(ema50_disp),
        "ema150":          ema_series(ema150_disp),
        "ratioConditions": ratio_conditions,
        "ratioLine":       ratio_line_data,
        "ratioEma20":      ratio_ema20_data,
        "ratioEma150":     ratio_ema150_data,
    }


@app.post("/api/rs-scan")
def rs_scan(req: RSScanRequest):
    logger.info(f"RS Scan request: {req}")

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


@app.get("/health")
def health():
    return {"status": "ok"}
