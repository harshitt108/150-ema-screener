"""
Breakout Screener — 150-EMA reclaim + swing-high breakouts, on the price chart
and on the ratio (stock / benchmark) chart, at any supported timeframe.

Two independent signals per stock, same rule applied to each series:

  Price signal  — on some bar within the last `lookback_bars` bars:
    (a) close crossed above the 150 EMA within the last `cross_window` bars
        (i.e. a fresh trend, not a long-established one),
    (b) close is above the 150 EMA on the signal bar, and
    (c) close breaks the swing high: close > max(High of the prior
        `swing_period` bars), and the previous bar had NOT already broken its
        own prior swing high — only the FIRST close through the level fires,
        so a trending stock doesn't re-signal every bar.

  Ratio signal  — identical logic on the ratio series (stock close / benchmark
    close). The ratio has no intra-bar high, so the swing high is the max of
    the prior `swing_period` ratio values.

The rule is bar-based, so it works unchanged on any timeframe in
TIMEFRAME_MAP; "days" in the daily UI simply become bars elsewhere. The
monthly fetch window (~240 bars) barely clears the ~190-bar minimum, so many
symbols come back as no-data there — expected, not a bug.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd

from data_fetcher import fetch_ohlcv
from scanner import TIMEFRAME_MAP, NO_DATA, calculate_ema
from rs_scanner import BENCHMARK_MAP, _compute_ratio
from symbol_names import SYMBOL_NAMES

logger = logging.getLogger(__name__)

_EMA_PERIOD = 150

# Bars of close history returned per result — feeds the table's mini price line.
_SPARK_DAYS = 30


def _fmt_bar_time(ts, interval: str) -> str:
    """Bar timestamp as string — date-only for daily+; date & time for intraday,
    where several bars share one calendar date. The fetcher's index is UTC, so
    intraday bars are shown in IST (market time)."""
    if interval in ("1d", "1wk", "1mo"):
        return ts.strftime("%Y-%m-%d")
    if ts.tzinfo is not None:
        ts = ts.tz_convert("Asia/Kolkata")
    return ts.strftime("%Y-%m-%d %H:%M")


def _signal_series(close: pd.Series, high: pd.Series, swing_period: int, cross_window: int):
    """Vectorized signal computation over a full series.

    Returns (signal, ema, level, cross_up) — all aligned to `close`:
      signal   bool: rule fired on this bar (fresh breakout + EMA conditions)
      ema      float: the 150 EMA of `close`
      level    float: the swing-high level in force on this bar
                      (max of the prior `swing_period` highs)
      cross_up bool: close crossed above the EMA on this bar
    """
    ema = calculate_ema(close, _EMA_PERIOD)
    above = close > ema                      # False while EMA is still NaN
    cross_up = above & ~above.shift(1, fill_value=False)
    # Did a cross happen within the last `cross_window` bars (incl. this one)?
    recent_cross = cross_up.astype(float).rolling(cross_window, min_periods=1).max() > 0

    level = high.shift(1).rolling(swing_period).max()
    broke = close > level                    # False while level is still NaN
    fresh = broke & ~broke.shift(1, fill_value=False)

    return (fresh & above & recent_cross), ema, level, cross_up


def _latest_event(signal, close, ema, level, cross_up, lookback_bars: int, digits: int, interval: str):
    """Most recent signal bar within the last `lookback_bars` bars, or None."""
    n = len(signal)
    fires = [i for i in range(max(0, n - lookback_bars), n) if bool(signal.iloc[i])]
    if not fires:
        return None
    t = fires[-1]

    cross_bars_ago = None
    for j in range(t, -1, -1):
        if bool(cross_up.iloc[j]):
            cross_bars_ago = t - j
            break

    c = float(close.iloc[t])
    e = float(ema.iloc[t])
    return {
        "date":         _fmt_bar_time(signal.index[t], interval),
        "barsAgo":      n - 1 - t,
        "close":        round(c, digits),
        "level":        round(float(level.iloc[t]), digits),
        "emaDist":      round((c - e) / e * 100, 2) if e else None,
        "crossBarsAgo": cross_bars_ago,
        "count":        len(fires),   # fires in the window (most recent shown)
    }


def analyze_breakout(symbol: str, bench_df, interval: str, period: str,
                     swing_period: int, cross_window: int, lookback_bars: int):
    """Return a result row if the price and/or ratio signal fired in the window,
    None if neither did, NO_DATA if the stock couldn't be analyzed."""
    df = fetch_ohlcv(f"{symbol}.NS", interval, period)
    # The rule needs a settled 150 EMA plus room for the cross window and swing
    # lookback — series with too little history can't be judged and count as no-data.
    min_bars = _EMA_PERIOD + cross_window + swing_period
    if df is None or len(df) < min_bars:
        return NO_DATA

    close = df["Close"]

    p_sig, p_ema, p_level, p_cross = _signal_series(close, df["High"], swing_period, cross_window)
    price_ev = _latest_event(p_sig, close, p_ema, p_level, p_cross, lookback_bars, digits=2, interval=interval)

    ratio_ev = None
    if bench_df is not None:
        ratio = _compute_ratio(df, bench_df, interval)
        if ratio is not None and len(ratio) >= min_bars:
            r_sig, r_ema, r_level, r_cross = _signal_series(ratio, ratio, swing_period, cross_window)
            ratio_ev = _latest_event(r_sig, ratio, r_ema, r_level, r_cross, lookback_bars, digits=6, interval=interval)

    if not price_ev and not ratio_ev:
        return None

    return {
        "symbol": symbol,
        "name":   SYMBOL_NAMES.get(symbol, symbol),
        "ltp":    round(float(close.iloc[-1]), 2),
        "price":  price_ev,
        "ratio":  ratio_ev,
        "spark":  [{"date": _fmt_bar_time(idx, interval), "close": round(float(v), 2)}
                   for idx, v in close.tail(_SPARK_DAYS).items()],
    }


def scan_breakouts(
    symbols: list,
    benchmark: str = "NIFTY 50",
    timeframe: str = "daily",
    swing_period: int = 10,
    cross_window: int = 30,
    lookback_bars: int = 10,
    max_workers: int = 15,
):
    """Scan `symbols` for EMA-reclaim swing-high breakouts at `timeframe`.
    Returns (results, no_data) like the other scan engines."""
    interval, period = TIMEFRAME_MAP[timeframe]

    bench_df = None
    bench_yahoo = BENCHMARK_MAP.get(benchmark)
    if bench_yahoo:
        bench_df = fetch_ohlcv(bench_yahoo, interval, period)
        if bench_df is not None:
            logger.info(f"Pre-fetched {benchmark} ({len(bench_df)} bars)")
        else:
            logger.warning(f"Benchmark {benchmark} unavailable — scanning price signal only")

    results = []
    no_data = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(analyze_breakout, sym, bench_df, interval, period,
                            swing_period, cross_window, lookback_bars): sym
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
                logger.debug(f"Breakout scan error for {sym}: {e}")

    # Freshest signals first; stocks firing on BOTH charts rank above single-signal
    # peers of the same age.
    def sort_key(r):
        ages = [ev["barsAgo"] for ev in (r["price"], r["ratio"]) if ev]
        both = 1 if (r["price"] and r["ratio"]) else 0
        return (min(ages), -both, r["symbol"])

    results.sort(key=sort_key)
    return results, no_data
