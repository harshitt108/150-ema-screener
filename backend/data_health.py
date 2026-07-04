"""Data-quality guardrails.

Two layers keep bad market data from ever silently reaching a chart or scan:

1. SELF-HEALING (in data_fetcher.fetch_ohlcv): the forming-bar live-price
   backfill and flat zero-volume-bar filter repair the known Yahoo quirks.

2. DETECTION (this module):
   • `inspect_ohlcv()` — a dependency-free structural validator called on EVERY
     fetch as a tripwire; anything malformed is logged loudly (WARNING) instead
     of quietly rendering wrong.
   • `run_health_sweep()` — a cross-symbol audit (used by /api/data-health and
     the daily scheduled job) that also detects STALENESS by comparing each
     symbol's last-bar date to the universe's latest session for that timeframe.

The staleness bug that started this (KPITTECH stuck at 671 after crashing to
557 because the forming bar was dropped) is auto-healed by layer 1; layer 2
exists to catch the *next*, unknown kind of glitch before a trader does.
"""
import logging
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd

logger = logging.getLogger(__name__)

# A symbol whose last bar lags the universe's latest session (for its timeframe)
# by more than this many calendar days is flagged stale. Generous enough to
# tolerate a genuine multi-day trading halt / long holiday run without noise.
STALE_MAX_LAG_DAYS = 6


def inspect_ohlcv(df, symbol="", timeframe="") -> list:
    """Structural validation of one fetched OHLCV frame. Returns a list of issue
    codes (empty = clean). PURE — never mutates. Deliberately has no staleness
    check (that needs a cross-symbol reference); it's safe to call per-fetch."""
    if df is None or len(df) == 0:
        return ["EMPTY"]

    issues = []
    ohlc = ["Open", "High", "Low", "Close"]

    # NaN in the most recent bars (the ones users actually look at)
    if df.tail(5)[ohlc].isna().any().any():
        issues.append("NAN_OHLC")

    # Last-bar OHLC ordering must hold: High ≥ max(O,L,C), Low ≤ min(O,H,C)
    r = df.iloc[-1]
    if r[ohlc].notna().all():
        hi, lo, op, cl = float(r["High"]), float(r["Low"]), float(r["Open"]), float(r["Close"])
        if hi + 1e-6 < max(lo, op, cl) or lo - 1e-6 > min(hi, op, cl):
            issues.append("BAD_OHLC")

    if (df["Close"] <= 0).any():
        issues.append("NONPOS_CLOSE")

    # Flat zero-volume padding bar that the fetcher's filter should have removed
    if int(((df["Volume"] == 0) & (df["High"] == df["Low"])).sum()) > 0:
        issues.append("FLAT0")

    return issues


def _last_date(df):
    return None if df is None or len(df) == 0 else df.index[-1].date().isoformat()


def run_health_sweep(symbols=None, timeframes=None, max_workers=16) -> dict:
    """Fetch every (symbol, timeframe) and report a categorized health summary.
    Detects structural issues AND staleness (per-timeframe, vs the universe's
    most common latest-session date). Returns a JSON-serializable dict."""
    # Lazy imports avoid a circular dependency (data_fetcher imports us).
    from data_fetcher import fetch_ohlcv
    from indices import INDEX_NAMES, get_symbols
    from scanner import TIMEFRAME_MAP

    if symbols is None:
        symbols = sorted(set(get_symbols(INDEX_NAMES)))
    if timeframes is None:
        timeframes = list(TIMEFRAME_MAP.keys())

    def one(sym, tf):
        interval, period = TIMEFRAME_MAP[tf]
        rec = {"sym": sym, "tf": tf, "issues": [], "last_date": None, "bars": 0}
        try:
            df = fetch_ohlcv(f"{sym}.NS", interval, period)
        except Exception as e:  # noqa: BLE001 — record, don't crash the sweep
            rec["issues"].append(f"EXC:{type(e).__name__}")
            return rec
        if df is None or len(df) < 20:
            rec["issues"].append("INSUFFICIENT_HISTORY")
            rec["bars"] = 0 if df is None else len(df)
            rec["last_date"] = _last_date(df)
            return rec
        rec["bars"] = len(df)
        rec["last_date"] = _last_date(df)
        rec["issues"] = inspect_ohlcv(df, sym, tf)
        return rec

    records = []
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = [ex.submit(one, s, tf) for s in symbols for tf in timeframes]
        for fut in as_completed(futs):
            records.append(fut.result())

    # Per-timeframe reference = the most common last-bar date (the true latest
    # session). Any symbol lagging it by > STALE_MAX_LAG_DAYS is stale.
    ref = {}
    for tf in timeframes:
        dates = [r["last_date"] for r in records if r["tf"] == tf and r["last_date"] and r["bars"]]
        ref[tf] = Counter(dates).most_common(1)[0][0] if dates else None

    for r in records:
        rd, tf = r["last_date"], r["tf"]
        if r["bars"] and rd and ref.get(tf):
            lag = (pd.Timestamp(ref[tf]) - pd.Timestamp(rd)).days
            if lag > STALE_MAX_LAG_DAYS:
                r["issues"].append(f"STALE(lag={lag}d,{rd})")

    flagged = [r for r in records if r["issues"]]
    by_cat = defaultdict(list)
    for r in flagged:
        for iss in r["issues"]:
            by_cat[iss.split("(")[0].split(":")[0]].append(f"{r['sym']}/{r['tf']}")

    return {
        "reference_session": ref,
        "checked": len(records),
        "clean": len(records) - len(flagged),
        "flagged": len(flagged),
        "categories": {k: {"count": len(v), "examples": v[:25]} for k, v in sorted(by_cat.items())},
        "healthy": len(flagged) == 0,
    }
