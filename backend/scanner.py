import pandas as pd
import numpy as np
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
import logging

from data_fetcher import fetch_ohlcv
from indicators import compute_signals

logger = logging.getLogger(__name__)

# Sentinel: returned when a symbol could not be fetched / had insufficient data,
# as distinct from None which means "fetched fine but did not match the filter".
NO_DATA = object()

TIMEFRAME_MAP = {
    "5min":    ("5m",  "60d"),   # Yahoo max for sub-hourly intervals
    "15min":   ("15m", "60d"),
    "30min":   ("30m", "60d"),
    "1h":      ("1h",  "365d"),  # Yahoo supports up to 730d; 365d gives ~2500 bars — fully settles 200 EMA
    "2h":      ("2h",  "60d"),   # remapped to 90m in data_fetcher (Yahoo has no 2h interval)
    "4h":      ("4h",  "90d"),   # falls back to 1d in data_fetcher
    "daily":   ("1d",  "2y"),
    "weekly":  ("1wk", "10y"),   # 10y → ~520 bars; MACD(26) needs 161 to settle
    "monthly": ("1mo", "20y"),   # 20y → ~240 bars; fully settles MACD signal line
}


def calculate_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def calculate_avg_volume(volume: pd.Series, lookback: int = 20) -> float:
    if len(volume) < lookback + 1:
        return float(volume.mean())
    return float(volume.iloc[-lookback - 1:-1].mean())


def ema_status(series: pd.Series, period: int) -> Optional[dict]:
    """For a series, return {'above': bool, 'dist': pct} vs its EMA(period).
    Returns None if there is insufficient history for the EMA to be meaningful."""
    if series is None or len(series) < period:
        return None
    ema = calculate_ema(series, period)
    cur = float(series.iloc[-1])
    cur_ema = float(ema.iloc[-1])
    if cur_ema == 0:
        return None
    dist = (cur - cur_ema) / cur_ema * 100
    return {"above": cur > cur_ema, "dist": round(dist, 2)}


def ema_panel(series: pd.Series, periods=(20, 50, 150)) -> dict:
    """Build {'ema20': {...}, 'ema50': {...}, 'ema150': {...}} for a series."""
    return {f"ema{p}": ema_status(series, p) for p in periods}


def analyze_stock(
    nse_symbol: str,
    interval: str,
    period: str,
    ema_period: int,
    condition: str,
    distance_pct: float,
    cross_lookback: int,
) -> Optional[dict]:
    yahoo_symbol = f"{nse_symbol}.NS"
    df = fetch_ohlcv(yahoo_symbol, interval, period)

    if df is None or len(df) < ema_period + 5:
        return NO_DATA

    df["ema"] = calculate_ema(df["Close"], ema_period)
    df = df.dropna(subset=["ema"])

    if len(df) < 2:
        return None

    current_close = float(df["Close"].iloc[-1])
    current_ema = float(df["ema"].iloc[-1])

    if current_ema == 0:
        return None

    dist = ((current_close - current_ema) / current_ema) * 100
    avg_vol = calculate_avg_volume(df["Volume"])
    current_vol = float(df["Volume"].iloc[-1]) if df["Volume"].iloc[-1] else 0
    vol_ratio = round(current_vol / avg_vol, 2) if avg_vol > 0 else 0

    signal = None

    if condition == "near_ema":
        if abs(dist) <= distance_pct:
            signal = "Near EMA"

    elif condition == "above_ema":
        if dist > 0:
            signal = "Above EMA"

    elif condition == "below_ema":
        if dist < 0:
            signal = "Below EMA"

    elif condition == "crossed_above":
        lookback = min(cross_lookback, len(df) - 1)
        for i in range(1, lookback + 1):
            idx = -i
            prev_idx = -(i + 1)
            if abs(prev_idx) > len(df):
                break
            prev_close = float(df["Close"].iloc[prev_idx])
            curr_close = float(df["Close"].iloc[idx])
            prev_ema = float(df["ema"].iloc[prev_idx])
            curr_ema = float(df["ema"].iloc[idx])
            if prev_close < prev_ema and curr_close > curr_ema:
                signal = "Cross Above"
                break

    elif condition == "crossed_below":
        lookback = min(cross_lookback, len(df) - 1)
        for i in range(1, lookback + 1):
            idx = -i
            prev_idx = -(i + 1)
            if abs(prev_idx) > len(df):
                break
            prev_close = float(df["Close"].iloc[prev_idx])
            curr_close = float(df["Close"].iloc[idx])
            prev_ema = float(df["ema"].iloc[prev_idx])
            curr_ema = float(df["ema"].iloc[idx])
            if prev_close > prev_ema and curr_close < curr_ema:
                signal = "Cross Below"
                break

    if signal is None:
        return None

    sparkline_df = df.tail(60)
    sparkline = [round(float(p), 2) for p in sparkline_df["Close"].tolist()]
    ema_line = [round(float(p), 2) for p in sparkline_df["ema"].tolist()]

    signals = compute_signals(df, ratio=None)

    return {
        "symbol": nse_symbol,
        "ltp": round(current_close, 2),
        "ema": round(current_ema, 2),
        "distance": round(dist, 2),
        "signal": signal,
        "volume": int(current_vol),
        "avgVolume": int(avg_vol),
        "volRatio": vol_ratio,
        "priceEmas": ema_panel(df["Close"]),
        "signals": signals,
    }


def scan_stocks(
    symbols: list,
    timeframe: str,
    ema_period: int,
    condition: str,
    distance_pct: float,
    cross_lookback: int,
    max_workers: int = 20,
) -> list:
    if timeframe not in TIMEFRAME_MAP:
        raise ValueError(f"Unknown timeframe: {timeframe}")

    interval, period = TIMEFRAME_MAP[timeframe]
    results = []
    no_data = []

    def process(nse_sym):
        return analyze_stock(
            nse_sym, interval, period,
            ema_period, condition, distance_pct, cross_lookback
        )

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process, sym): sym for sym in symbols}
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
                logger.debug(f"Error processing {sym}: {e}")

    results.sort(key=lambda x: abs(x["distance"]))
    return results, no_data
