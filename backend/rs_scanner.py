import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
import logging

from data_fetcher import fetch_ohlcv
from scanner import calculate_ema, calculate_avg_volume, ema_panel, TIMEFRAME_MAP, NO_DATA
from indicators import compute_signals

logger = logging.getLogger(__name__)

BENCHMARK_MAP = {
    "NIFTY 50":           "^NSEI",
    "NIFTY Next 50":      "^NSMIDCP",
    "NIFTY 100":          "^CNX100",
    "NIFTY 500":          "^CRSLDX",
    "NIFTY Midcap 100":   "^CNXMIDCAP",
    "NIFTY Midcap 150":   "^NSMIDCP150",
    "NIFTY Smallcap 250": "^CNXSC",
    "NIFTY Auto":         "^CNXAUTO",
    "NIFTY IT":           "^CNXIT",
    "NIFTY Pharma":       "^CNXPHARMA",
    "NIFTY FMCG":         "^CNXFMCG",
    "NIFTY Metal":        "^CNXMETAL",
    "NIFTY Bank":         "^NSEBANK",
    "NIFTY Realty":       "^CNXREALTY",
    "NIFTY Energy":       "^CNXENERGY",
}

BENCHMARK_NAMES = ["Sector Index (Auto Detect)"] + list(BENCHMARK_MAP.keys())

SECTOR_AUTO_MAP = {
    # IT
    "TCS": "NIFTY IT", "INFY": "NIFTY IT", "HCLTECH": "NIFTY IT",
    "WIPRO": "NIFTY IT", "TECHM": "NIFTY IT", "LTM": "NIFTY IT",
    "PERSISTENT": "NIFTY IT", "COFORGE": "NIFTY IT", "MPHASIS": "NIFTY IT", "OFSS": "NIFTY IT",
    # Auto
    "MARUTI": "NIFTY Auto", "TMPV": "NIFTY Auto", "M&M": "NIFTY Auto",
    "BAJAJ-AUTO": "NIFTY Auto", "EICHERMOT": "NIFTY Auto", "HEROMOTOCO": "NIFTY Auto",
    "TVSMOTOR": "NIFTY Auto", "ASHOKLEY": "NIFTY Auto", "MOTHERSON": "NIFTY Auto",
    "BALKRISIND": "NIFTY Auto", "BHARATFORG": "NIFTY Auto", "BOSCHLTD": "NIFTY Auto",
    "MRF": "NIFTY Auto", "EXIDEIND": "NIFTY Auto",
    # Pharma
    "SUNPHARMA": "NIFTY Pharma", "DRREDDY": "NIFTY Pharma", "CIPLA": "NIFTY Pharma",
    "DIVISLAB": "NIFTY Pharma", "LUPIN": "NIFTY Pharma", "AUROPHARMA": "NIFTY Pharma",
    "TORNTPHARM": "NIFTY Pharma", "ZYDUSLIFE": "NIFTY Pharma", "ALKEM": "NIFTY Pharma",
    "GLENMARK": "NIFTY Pharma", "GRANULES": "NIFTY Pharma", "LAURUSLABS": "NIFTY Pharma",
    # FMCG
    "HINDUNILVR": "NIFTY FMCG", "ITC": "NIFTY FMCG", "NESTLEIND": "NIFTY FMCG",
    "BRITANNIA": "NIFTY FMCG", "DABUR": "NIFTY FMCG", "MARICO": "NIFTY FMCG",
    "GODREJCP": "NIFTY FMCG", "COLPAL": "NIFTY FMCG", "TATACONSUM": "NIFTY FMCG",
    "UBL": "NIFTY FMCG", "EMAMILTD": "NIFTY FMCG", "VBL": "NIFTY FMCG",
    # Metal
    "JSWSTEEL": "NIFTY Metal", "TATASTEEL": "NIFTY Metal", "HINDALCO": "NIFTY Metal",
    "SAIL": "NIFTY Metal", "VEDL": "NIFTY Metal", "COALINDIA": "NIFTY Metal",
    "JINDALSTEL": "NIFTY Metal", "NATIONALUM": "NIFTY Metal",
    # Energy
    "RELIANCE": "NIFTY Energy", "ONGC": "NIFTY Energy", "NTPC": "NIFTY Energy",
    "POWERGRID": "NIFTY Energy", "BPCL": "NIFTY Energy", "IOC": "NIFTY Energy",
    "GAIL": "NIFTY Energy", "PETRONET": "NIFTY Energy", "NHPC": "NIFTY Energy",
    "TATAPOWER": "NIFTY Energy", "ADANIGREEN": "NIFTY Energy", "ADANIPOWER": "NIFTY Energy",
    "TORNTPOWER": "NIFTY Energy", "CESC": "NIFTY Energy",
    # Bank
    "HDFCBANK": "NIFTY Bank", "ICICIBANK": "NIFTY Bank", "KOTAKBANK": "NIFTY Bank",
    "AXISBANK": "NIFTY Bank", "SBIN": "NIFTY Bank", "INDUSINDBK": "NIFTY Bank",
    "BANKBARODA": "NIFTY Bank", "FEDERALBNK": "NIFTY Bank", "IDFCFIRSTB": "NIFTY Bank",
    "BANDHANBNK": "NIFTY Bank", "PNB": "NIFTY Bank", "AUBANK": "NIFTY Bank",
    # Realty
    "DLF": "NIFTY Realty", "GODREJPROP": "NIFTY Realty", "PRESTIGE": "NIFTY Realty",
    "LODHA": "NIFTY Realty", "OBEROIRLTY": "NIFTY Realty", "SOBHA": "NIFTY Realty",
    "MAHLIFE": "NIFTY Realty", "BRIGADE": "NIFTY Realty",
}


def _normalize_index(df: pd.DataFrame, interval: str) -> pd.DataFrame:
    """Strip time component for daily/weekly/monthly so timestamps align."""
    if interval in ("1d", "1wk", "1mo"):
        df = df.copy()
        df.index = df.index.normalize()
    return df


def _compute_ratio(
    stock_df: pd.DataFrame,
    bench_df: pd.DataFrame,
    interval: str,
) -> Optional[pd.Series]:
    stock_df = _normalize_index(stock_df, interval)
    bench_df = _normalize_index(bench_df, interval)

    merged = (
        stock_df[["Close"]]
        .join(bench_df[["Close"]], how="inner", lsuffix="_s", rsuffix="_b")
        .dropna()
    )
    merged = merged[merged["Close_b"] != 0]

    if len(merged) < 20:
        return None

    return merged["Close_s"] / merged["Close_b"]


def _rs_trend(ema_series: pd.Series, lookback: int = 15) -> str:
    if len(ema_series) < lookback + 1:
        return "Unknown"
    start = float(ema_series.iloc[-lookback])
    if start == 0:
        return "Unknown"
    slope_pct = (float(ema_series.iloc[-1]) - start) / start * 100
    if slope_pct > 0.5:
        return "Rising"
    if slope_pct < -0.5:
        return "Falling"
    return "Sideways"


def _crossover(series: pd.Series, ema: pd.Series, direction: str, lookback: int) -> bool:
    lb = min(lookback, len(series) - 2)
    for i in range(1, lb + 1):
        if i + 1 > len(series) or i + 1 > len(ema):
            break
        pv = float(series.iloc[-(i + 1)])
        cv = float(series.iloc[-i])
        pe = float(ema.iloc[-(i + 1)])
        ce = float(ema.iloc[-i])
        if direction == "above" and pv < pe and cv > ce:
            return True
        if direction == "below" and pv > pe and cv < ce:
            return True
    return False


def _apply_condition(
    series: pd.Series,
    ema_series: pd.Series,
    condition: str,
    distance_pct: float,
    cross_lookback: int,
) -> Optional[str]:
    """Return signal string if condition is met, else None."""
    cur = float(series.iloc[-1])
    cur_ema = float(ema_series.iloc[-1])
    if cur_ema == 0:
        return None
    dist = (cur - cur_ema) / cur_ema * 100

    if condition == "ignore":
        return "N/A"
    if condition == "above_ema":
        return "Above EMA" if cur > cur_ema else None
    if condition == "below_ema":
        return "Below EMA" if cur < cur_ema else None
    if condition == "near_ema":
        return "Near EMA" if abs(dist) <= distance_pct else None
    if condition == "crossed_above":
        return "Cross Above" if _crossover(series, ema_series, "above", cross_lookback) else None
    if condition == "crossed_below":
        return "Cross Below" if _crossover(series, ema_series, "below", cross_lookback) else None
    return None


def analyze_rs_stock(
    nse_symbol: str,
    resolved_benchmark: str,
    bench_df: pd.DataFrame,
    interval: str,
    period: str,
    ema_period: int,
    rs_condition: str,
    distance_pct: float,
    cross_lookback: int,
    rs_trend_filter: str,
    price_condition: Optional[str],
    price_ema_period: int,
    price_distance_pct: float,
) -> Optional[dict]:
    stock_df = fetch_ohlcv(f"{nse_symbol}.NS", interval, period)
    if stock_df is None or len(stock_df) < max(ema_period, price_ema_period) + 5:
        return NO_DATA

    ratio = _compute_ratio(stock_df, bench_df, interval)
    if ratio is None or len(ratio) < ema_period + 5:
        return NO_DATA

    ratio_ema = calculate_ema(ratio, ema_period)
    if len(ratio_ema) < 2:
        return NO_DATA

    rs_trend = _rs_trend(ratio_ema)
    if rs_trend_filter and rs_trend_filter != "Any" and rs_trend != rs_trend_filter:
        return None

    rs_signal = _apply_condition(ratio, ratio_ema, rs_condition, distance_pct, cross_lookback)
    if rs_signal is None:
        return None

    ratio_dist = (float(ratio.iloc[-1]) - float(ratio_ema.iloc[-1])) / float(ratio_ema.iloc[-1]) * 100

    # Optional combined price condition (reuses already-fetched stock_df)
    price_signal = None
    price_ltp = None
    price_ema_val = None
    price_dist = None

    if price_condition and price_condition != "ignore":
        stock_norm = _normalize_index(stock_df, interval)
        if len(stock_norm) >= price_ema_period + 5:
            p_ema = calculate_ema(stock_norm["Close"], price_ema_period)
            if len(p_ema) >= 2:
                price_ltp = float(stock_norm["Close"].iloc[-1])
                price_ema_val = float(p_ema.iloc[-1])
                price_dist = (price_ltp - price_ema_val) / price_ema_val * 100
                price_signal = _apply_condition(
                    stock_norm["Close"], p_ema,
                    price_condition, price_distance_pct, cross_lookback,
                )
        if price_signal is None:
            return None

    avg_vol = calculate_avg_volume(stock_df["Volume"])
    current_vol = float(stock_df["Volume"].iloc[-1]) if stock_df["Volume"].iloc[-1] else 0
    vol_ratio = round(current_vol / avg_vol, 2) if avg_vol > 0 else 0
    ltp = float(stock_df["Close"].iloc[-1])

    # Ratio chart sparklines — always use ema_period (the RS EMA period)
    sparkline_ratio = [round(float(v), 8) for v in ratio.tail(60).tolist()]
    sparkline_ratio_ema = [round(float(v), 8) for v in ratio_ema.tail(60).tolist()]

    # Price chart sparklines — use price_ema_period when the combined price
    # filter is active; otherwise fall back to the RS ema_period so the EMA
    # shown on the price sparkline matches what the scan actually used.
    chart_price_ema_period = price_ema_period if (price_condition and price_condition != "ignore") else ema_period
    price_ema_for_chart = calculate_ema(stock_df["Close"], chart_price_ema_period)
    sparkline_price = [round(float(v), 2) for v in stock_df["Close"].tail(60).tolist()]
    sparkline_price_ema = [round(float(v), 2) for v in price_ema_for_chart.tail(60).tolist()]

    # Multi-EMA structure for price and ratio, in the selected timeframe.
    price_emas = ema_panel(stock_df["Close"])
    ratio_emas = ema_panel(ratio)

    signals = compute_signals(stock_df, ratio=ratio)

    return {
        "symbol": nse_symbol,
        "benchmark": resolved_benchmark,
        "ltp": round(ltp, 2),
        "ratio": round(float(ratio.iloc[-1]), 6),
        "ratioEma": round(float(ratio_ema.iloc[-1]), 6),
        "ratioDistance": round(ratio_dist, 2),
        "rsSignal": rs_signal,
        "rsTrend": rs_trend,
        "priceSignal": price_signal,
        "priceLtp": round(price_ltp, 2) if price_ltp is not None else None,
        "priceEma": round(price_ema_val, 2) if price_ema_val is not None else None,
        "priceDist": round(price_dist, 2) if price_dist is not None else None,
        "volume": int(current_vol),
        "volRatio": vol_ratio,
        "priceEmaPeriodUsed": chart_price_ema_period,
        "ratioEmaPeriodUsed": ema_period,
        "priceEmas": price_emas,
        "ratioEmas": ratio_emas,
        "signals": signals,
    }


def scan_rs_stocks(
    symbols: list,
    benchmark: str,
    timeframe: str,
    ema_period: int,
    rs_condition: str,
    distance_pct: float,
    cross_lookback: int,
    rs_trend_filter: str,
    price_condition: Optional[str],
    price_ema_period: int,
    price_distance_pct: float,
    max_workers: int = 15,
) -> list:
    if timeframe not in TIMEFRAME_MAP:
        raise ValueError(f"Unknown timeframe: {timeframe}")

    interval, period = TIMEFRAME_MAP[timeframe]

    # Pre-fetch benchmark(s) once before parallel stock scanning
    if benchmark == "Sector Index (Auto Detect)":
        needed = {SECTOR_AUTO_MAP.get(sym, "NIFTY 50") for sym in symbols}
        bench_cache: dict[str, pd.DataFrame] = {}
        for sector in needed:
            yahoo_sym = BENCHMARK_MAP.get(sector)
            if yahoo_sym:
                df = fetch_ohlcv(yahoo_sym, interval, period)
                if df is not None:
                    bench_cache[sector] = df
                    logger.info(f"Pre-fetched {sector} ({len(df)} bars)")
    else:
        yahoo_sym = BENCHMARK_MAP.get(benchmark)
        if not yahoo_sym:
            raise ValueError(f"Unknown benchmark: {benchmark}")
        df = fetch_ohlcv(yahoo_sym, interval, period)
        if df is None:
            raise ValueError(f"Could not fetch data for benchmark: {benchmark}")
        bench_cache = {benchmark: df}
        logger.info(f"Pre-fetched {benchmark} ({len(df)} bars)")

    results = []
    no_data = []

    def process(sym: str):
        resolved = SECTOR_AUTO_MAP.get(sym, "NIFTY 50") if benchmark == "Sector Index (Auto Detect)" else benchmark
        bench = bench_cache.get(resolved)
        if bench is None:
            return NO_DATA
        return analyze_rs_stock(
            sym, resolved, bench, interval, period,
            ema_period, rs_condition, distance_pct, cross_lookback,
            rs_trend_filter, price_condition, price_ema_period, price_distance_pct,
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
                logger.debug(f"RS scan error for {sym}: {e}")

    results.sort(key=lambda x: abs(x["ratioDistance"]))
    return results, no_data
