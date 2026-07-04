"""
Rating Screener — daily-timeframe screener over the walk-forward Rating
History score (indicators.compute_rating_history, the same score shown in
the chart panel's Rating History section).

Flags every stock where, within the last `lookback_days` trading days,
either of these happened between two consecutive daily bars:
  (a) the rating bucket changed (e.g. Hold → Buy, Buy → Strong Buy), or
  (b) the score moved by >= `move_threshold` points (either direction).

Daily timeframe only — the rating score is defined on settled daily bars.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from data_fetcher import fetch_ohlcv
from scanner import TIMEFRAME_MAP, NO_DATA
from rs_scanner import BENCHMARK_MAP, _compute_ratio
from indicators import compute_rating_history
from symbol_names import SYMBOL_NAMES

logger = logging.getLogger(__name__)

_INTERVAL, _PERIOD = TIMEFRAME_MAP["daily"]

# Bars of score history returned per result — feeds the table's trend sparkline.
_SPARK_DAYS = 20


def analyze_rating_shift(symbol: str, bench_df, lookback_days: int, move_threshold: float):
    """Return a result row if the stock had a rating shift / big score move in
    the window, None if it didn't, NO_DATA if the stock couldn't be analyzed."""
    df = fetch_ohlcv(f"{symbol}.NS", _INTERVAL, _PERIOD)
    if df is None or len(df) < 30:
        return NO_DATA

    ratio = _compute_ratio(df, bench_df, _INTERVAL) if bench_df is not None else None

    history = compute_rating_history(df, ratio, days=max(lookback_days + 1, _SPARK_DAYS))
    if len(history) < 2:
        return NO_DATA

    events = []
    window = history[-(lookback_days + 1):]
    for prev, cur in zip(window, window[1:]):
        delta = round(cur["score"] - prev["score"], 1)
        bucket_shift = cur["rating"] != prev["rating"]
        big_move = abs(delta) >= move_threshold
        if not (bucket_shift or big_move):
            continue
        events.append({
            "date":        cur["date"],
            "fromRating":  prev["rating"],
            "toRating":    cur["rating"],
            "fromScore":   prev["score"],
            "toScore":     cur["score"],
            "change":      delta,
            "direction":   "up" if delta > 0 else "down",
            "bucketShift": bucket_shift,
            "bigMove":     big_move,
        })

    if not events:
        return None

    latest = events[-1]
    return {
        "symbol":        symbol,
        "name":          SYMBOL_NAMES.get(symbol, symbol),
        "ltp":           round(float(df["Close"].iloc[-1]), 2),
        "event":         latest,
        "eventCount":    len(events),
        "currentScore":  history[-1]["score"],
        "currentRating": history[-1]["rating"],
        "scoreSpark":    [{"score": h["score"], "rating": h["rating"], "date": h["date"]}
                          for h in history[-_SPARK_DAYS:]],
    }


def scan_rating_shifts(
    symbols: list,
    benchmark: str = "NIFTY 50",
    lookback_days: int = 1,
    move_threshold: float = 20.0,
    max_workers: int = 15,
):
    """Scan `symbols` for rating shifts / big score moves on the daily timeframe.
    Returns (results, no_data) like the other scan engines."""
    # Pre-fetch the benchmark once so the ratio conditions (11-13) match the
    # chart panel's Rating History. If it can't be fetched, score on the 10
    # price/technical conditions — same degradation as the rating endpoint.
    bench_df = None
    bench_yahoo = BENCHMARK_MAP.get(benchmark)
    if bench_yahoo:
        bench_df = fetch_ohlcv(bench_yahoo, _INTERVAL, _PERIOD)
        if bench_df is not None:
            logger.info(f"Pre-fetched {benchmark} ({len(bench_df)} bars)")
        else:
            logger.warning(f"Benchmark {benchmark} unavailable — scoring without ratio conditions")

    results = []
    no_data = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(analyze_rating_shift, sym, bench_df, lookback_days, move_threshold): sym
            for sym in symbols
        }
        for future in as_completed(futures):
            sym = futures[future]
            try:
                result = future.result()
                if result is NO_DATA:
                    no_data.append(sym)
                elif result:
                    results.append(result)
            except Exception as e:
                no_data.append(sym)
                logger.debug(f"Rating scan error for {sym}: {e}")

    results.sort(key=lambda r: abs(r["event"]["change"]), reverse=True)
    return results, no_data
