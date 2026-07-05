"""
Index Scanner — scans every major NSE index (broad, sectoral, thematic) and
returns a dashboard snapshot: recent strong / weak sectors plus a full table of
each index's EMA structure (20/50/150/200), technical score and trailing returns.

All Yahoo tickers below were verified to return >=250 daily bars (deep enough for
a settled 200 EMA). Symbols are NOT guessed — the ones that silently return no
data on Yahoo (e.g. ^CNXMIDCAP, ^CNXSC, smallcap indices) are deliberately
excluded rather than shipped as dead rows. See scanner-data-validation memory.

The ~18 indices in nse_index_data.NSE_INDEX_NAME are sourced from NSE's own
archive instead — Yahoo stopped returning historical data for them (confirmed
Jul 2026; they still show a Yahoo symbol below for resolve_yahoo_symbol's
sake, but analyze_index() and fetch_chart_ohlcv() route them to NSE, not
Yahoo). Every other index is untouched.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import pandas as pd

from data_fetcher import fetch_ohlcv
from scanner import calculate_ema, ema_status, ema_panel, TIMEFRAME_MAP, NO_DATA
from indicators import compute_signals, rsi as calc_rsi
from rs_scanner import _compute_ratio, _rs_trend
from nse_index_data import get_index_ohlcv, NSE_INDEX_NAME

logger = logging.getLogger(__name__)

# Everything on this screen is measured against NIFTY 50 — the relative-strength
# ratio (index / NIFTY 50) tells you whether a sector is actually leading the
# market or just riding it up. This is the benchmark for the whole module.
BENCHMARK_NAME = "NIFTY 50"
BENCHMARK_SYMBOL = "^NSEI"

# name -> (yahoo symbol, category). Order within a category is display order.
INDEX_UNIVERSE = {
    # ── Broad market ────────────────────────────────────────────────────────
    "NIFTY 50":            ("^NSEI",               "Broad"),
    "NIFTY Next 50":       ("^NSMIDCP",            "Broad"),
    "NIFTY 100":           ("^CNX100",             "Broad"),
    "NIFTY 200":           ("^CNX200",             "Broad"),
    "NIFTY 500":           ("^CRSLDX",             "Broad"),
    "NIFTY Midcap 50":     ("^NSEMDCP50",          "Broad"),
    "NIFTY Midcap 100":    ("NIFTY_MIDCAP_100.NS", "Broad"),
    "NIFTY Midcap 150":    ("NIFTYMIDCAP150.NS",   "Broad"),

    # ── Sectoral ──────────────────────────────────────────────────────────────
    "NIFTY Bank":          ("^NSEBANK",             "Sectoral"),
    "NIFTY IT":            ("^CNXIT",               "Sectoral"),
    "NIFTY Auto":          ("^CNXAUTO",             "Sectoral"),
    "NIFTY Pharma":        ("^CNXPHARMA",           "Sectoral"),
    "NIFTY FMCG":          ("^CNXFMCG",             "Sectoral"),
    "NIFTY Metal":         ("^CNXMETAL",            "Sectoral"),
    "NIFTY Realty":        ("^CNXREALTY",           "Sectoral"),
    "NIFTY Energy":        ("^CNXENERGY",           "Sectoral"),
    "NIFTY Media":         ("^CNXMEDIA",            "Sectoral"),
    "NIFTY PSU Bank":      ("^CNXPSUBANK",          "Sectoral"),
    "NIFTY Fin Services":  ("NIFTY_FIN_SERVICE.NS", "Sectoral"),
    "NIFTY Private Bank":  ("NIFTY_PVT_BANK.NS",    "Sectoral"),

    # ── Thematic ──────────────────────────────────────────────────────────────
    "NIFTY Infra":         ("^CNXINFRA",   "Thematic"),
    "NIFTY Commodities":   ("^CNXCMDT",    "Thematic"),
    "NIFTY Consumption":   ("^CNXCONSUM",  "Thematic"),
    "NIFTY PSE":           ("^CNXPSE",     "Thematic"),
    "NIFTY MNC":           ("^CNXMNC",     "Thematic"),
    "NIFTY Services":      ("^CNXSERVICE", "Thematic"),
    "NIFTY Dividend Opps": ("^CNXDIVOP",   "Thematic"),
}

# Trailing-return lookbacks in *bars*, per timeframe. Daily is the primary use
# (1D/1W/1M/3M ≈ 1/5/21/63 sessions).
_RETURN_BARS = {
    "daily":   {"r1": 1,  "r5": 5,  "r21": 21, "r63": 63},
    "weekly":  {"r1": 1,  "r5": 4,  "r21": 13, "r63": 26},
    "monthly": {"r1": 1,  "r5": 3,  "r21": 6,  "r63": 12},
}
# Labels shown in the UI for each lookback key, per timeframe.
RETURN_LABELS = {
    "daily":   {"r1": "1D", "r5": "1W", "r21": "1M", "r63": "3M"},
    "weekly":  {"r1": "1W", "r5": "1M", "r21": "3M", "r63": "6M"},
    "monthly": {"r1": "1M", "r5": "3M", "r21": "6M", "r63": "1Y"},
}


# UI symbol (display name or raw ticker) -> Yahoo symbol.
_NAME_TO_YAHOO = {name: sym for name, (sym, _cat) in INDEX_UNIVERSE.items()}
_YAHOO_SET = set(_NAME_TO_YAHOO.values())


def fetch_chart_ohlcv(symbol: str, interval: str, period: str) -> Optional[pd.DataFrame]:
    """Drop-in for fetch_ohlcv(resolve_yahoo_symbol(symbol), interval, period) —
    used by main.py's per-symbol chart/detail endpoints (chart, signals,
    mtf-matrix, signal-history, rating-history, compare-snapshot). Routes the
    ~18 NSE-sourced indices to their archive data so opening "NIFTY Auto"'s own
    chart works the same as the dashboard row; every other index and all
    stocks fetch from Yahoo exactly as before."""
    if symbol in NSE_INDEX_NAME:
        return get_index_ohlcv(symbol, interval)
    return fetch_ohlcv(resolve_yahoo_symbol(symbol), interval, period)


def resolve_yahoo_symbol(symbol: str) -> str:
    """Map a UI symbol to its Yahoo ticker for the chart/detail endpoints.

    Index display names ('NIFTY 50') and raw index tickers ('^NSEI',
    'NIFTY_FIN_SERVICE.NS') resolve to their Yahoo symbol as-is; everything else
    is a plain NSE stock and gets the '.NS' suffix — exactly the previous
    behaviour, so stock lookups are unchanged (no NSE stock ticker starts with
    '^', ends with '.NS', or matches an index name)."""
    if symbol in _NAME_TO_YAHOO:
        return _NAME_TO_YAHOO[symbol]
    if symbol in _YAHOO_SET or symbol.startswith("^") or symbol.endswith(".NS"):
        return symbol
    return f"{symbol}.NS"


def _pct_change(close: pd.Series, bars: int) -> Optional[float]:
    if bars <= 0 or len(close) <= bars:
        return None
    prev = float(close.iloc[-(bars + 1)])
    if prev == 0:
        return None
    return round((float(close.iloc[-1]) - prev) / prev * 100, 2)


def _relative_strength(df: pd.DataFrame, bench_df: Optional[pd.DataFrame],
                       interval: str, is_benchmark: bool, ret_bars: int) -> Optional[dict]:
    """Relative strength of this index vs NIFTY 50 — the ratio (index / NIFTY 50).
    Rising ratio = outperforming the market; falling = lagging. Returns None when
    the ratio can't be computed (e.g. the benchmark itself, or insufficient overlap)."""
    if is_benchmark:
        return {"isBenchmark": True, "trend": None, "ret": None, "aboveEma": None, "emas": None}
    if bench_df is None:
        return None
    ratio = _compute_ratio(df, bench_df, interval)
    if ratio is None or len(ratio) < 20:
        return None

    # RS trend from the slope of the ratio's 20-EMA (same method as the RS scanner)
    ratio_ema20 = calculate_ema(ratio, 20)
    trend = _rs_trend(ratio_ema20)

    # Ratio vs its OWN 20/50/150 EMAs — the same panel the RS screener shows.
    # Green when the ratio is above that EMA (index outperforming the market on
    # that horizon), red when below. Identical shape/component to the stock tables.
    ratio_emas = ema_panel(ratio)
    above_ema = bool(ratio_emas.get("ema50") and ratio_emas["ema50"]["above"])

    # Relative return over the 1M lookback: % change of the ratio = how much the
    # index out/under-performed NIFTY 50 over the window.
    rs_ret = None
    if len(ratio) > ret_bars > 0:
        prev = float(ratio.iloc[-(ret_bars + 1)])
        if prev != 0:
            rs_ret = round((float(ratio.iloc[-1]) - prev) / prev * 100, 2)

    return {"isBenchmark": False, "trend": trend, "ret": rs_ret,
            "aboveEma": above_ema, "emas": ratio_emas}


def analyze_index(name: str, yahoo_symbol: str, category: str,
                  interval: str, period: str, timeframe: str,
                  bench_df: Optional[pd.DataFrame] = None) -> Optional[dict]:
    # A handful of sector/thematic indices are dead on Yahoo (see module
    # docstring) — those route to NSE's own archive instead; everything else
    # is unchanged.
    df = get_index_ohlcv(name, interval) if name in NSE_INDEX_NAME else fetch_ohlcv(yahoo_symbol, interval, period)
    # Need enough history for a meaningful 150 EMA; 200 EMA is best-effort.
    if df is None or len(df) < 155:
        return NO_DATA

    close = df["Close"]
    ltp = round(float(close.iloc[-1]), 2)

    # EMA structure — 20/50/150/200. ema_status returns None if too little data.
    emas = {f"ema{p}": ema_status(close, p) for p in (20, 50, 150, 200)}
    above_count = sum(1 for v in emas.values() if v and v["above"])
    ema_total = sum(1 for v in emas.values() if v is not None)

    # Full technical condition engine (same one used for stocks).
    signals = compute_signals(df, ratio=None)

    rsi_val = round(float(calc_rsi(close, 14).iloc[-1]), 1)

    bars = _RETURN_BARS.get(timeframe, _RETURN_BARS["daily"])
    returns = {k: _pct_change(close, b) for k, b in bars.items()}

    # Relative strength vs NIFTY 50 (the module-wide benchmark).
    is_benchmark = yahoo_symbol == BENCHMARK_SYMBOL
    rs = _relative_strength(df, bench_df, interval, is_benchmark, bars["r21"])

    sparkline = [round(float(v), 2) for v in close.tail(60).tolist()]

    return {
        "asOf": df.index[-1].strftime("%Y-%m-%d"),
        "name": name,
        "symbol": yahoo_symbol,
        "category": category,
        "ltp": ltp,
        "returns": returns,
        "emas": emas,
        "aboveCount": above_count,
        "emaTotal": ema_total,
        "score": signals["pct"],
        "signal": signals["signal"],
        "bullCount": signals["bullCount"],
        "conditionTotal": signals["total"],
        "rsi": rsi_val,
        "rs": rs,
        # Ratio (index / NIFTY 50) vs its own 20/50/150 EMAs — powers the shared
        # "Ratio vs EMA" column (RatioGroup), same as the RS screener. None for the
        # benchmark itself or when the ratio couldn't be computed.
        "ratioEmas": (rs or {}).get("emas"),
        # Full signal object (with .conditions) powers the shared MomentumGroup
        # column — same component the stock tables use.
        "signals": signals,
        "sparkline": sparkline,
    }


def scan_indices(timeframe: str = "daily", max_workers: int = 12) -> tuple[list, list]:
    """Scan the full index universe at the given timeframe.

    Returns (rows, no_data) where rows is the per-index snapshot list sorted by
    recent momentum (1-month return, strongest first)."""
    if timeframe not in TIMEFRAME_MAP:
        raise ValueError(f"Unknown timeframe: {timeframe}")
    interval, period = TIMEFRAME_MAP[timeframe]

    # Pre-fetch NIFTY 50 once — every index's relative strength is measured
    # against it, so we fetch it a single time and reuse across all workers.
    bench_df = fetch_ohlcv(BENCHMARK_SYMBOL, interval, period)

    rows, no_data = [], []

    def process(item):
        name, (sym, cat) = item
        return name, analyze_index(name, sym, cat, interval, period, timeframe, bench_df)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process, item): item[0]
                   for item in INDEX_UNIVERSE.items()}
        for future in as_completed(futures):
            name = futures[future]
            try:
                _, result = future.result()
                if result is NO_DATA or result is None:
                    no_data.append(name)
                else:
                    rows.append(result)
            except Exception as e:
                no_data.append(name)
                logger.debug(f"Index scan error for {name}: {e}")

    # Sort by recent momentum (1-month return), strongest first; Nones last.
    rows.sort(key=lambda r: (r["returns"].get("r21") is None,
                             -(r["returns"].get("r21") or 0)))
    return rows, no_data


def build_dashboard(timeframe: str = "daily") -> dict:
    """Full dashboard payload: strong/weak sector leaders + the full index table."""
    rows, no_data = scan_indices(timeframe)

    # Strong/weak leaderboards are drawn from Sectoral + Thematic groups only —
    # broad-market indices aren't "sectors" and would drown out the signal.
    sectors = [r for r in rows
               if r["category"] in ("Sectoral", "Thematic")
               and r["returns"].get("r21") is not None]
    ranked = sorted(sectors, key=lambda r: r["returns"]["r21"], reverse=True)

    strong = ranked[:6]
    weak = list(reversed(ranked[-6:])) if len(ranked) > 6 else []
    # Avoid an index appearing in both lists when the universe is small.
    strong_names = {r["name"] for r in strong}
    weak = [r for r in weak if r["name"] not in strong_names]

    return {
        "timeframe": timeframe,
        "benchmark": BENCHMARK_NAME,
        # Most recent bar date across the universe — the UI's freshness stamp,
        # so "is this today or yesterday?" is answerable at a glance.
        "asOf": max((r["asOf"] for r in rows), default=None),
        "returnLabels": RETURN_LABELS.get(timeframe, RETURN_LABELS["daily"]),
        "strongSectors": strong,
        "weakSectors": weak,
        "indices": rows,
        "scanned": len(INDEX_UNIVERSE),
        "analyzed": len(rows),
        "noData": no_data,
    }
