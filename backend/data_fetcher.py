import requests
import pandas as pd
import time
from typing import Optional

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
})

INTERVAL_MAP = {
    "5m":   "5m",
    "15m":  "15m",
    "30m":  "30m",
    "1h":   "60m",
    "1d":   "1d",
    "1wk":  "1wk",
    "1mo":  "1mo",
}

YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"


def fetch_ohlcv(symbol: str, interval: str, period: str,
                max_retries: int = 3) -> Optional[pd.DataFrame]:
    yf_interval = INTERVAL_MAP.get(interval, interval)

    url = f"{YAHOO_BASE}/{symbol}"
    params = {
        "interval": yf_interval,
        "range": period,
        "includePrePost": "false",
        "events": "div,splits",
    }

    # Retry transient failures (rate-limit / server / timeout) with backoff so a
    # concurrent scan burst doesn't silently drop symbols. A 404 (delisted/bad
    # symbol) is permanent — don't waste retries on it.
    resp = None
    for attempt in range(max_retries):
        try:
            resp = SESSION.get(url, params=params, timeout=15)
        except requests.RequestException:
            resp = None  # network/timeout — treat as transient
        if resp is not None:
            if resp.status_code == 200:
                break
            if resp.status_code == 404:
                return None  # symbol genuinely not found — no point retrying
        if attempt < max_retries - 1:
            # 0.5s, 1s, 2s … exponential backoff (jittered by symbol hash)
            time.sleep(0.5 * (2 ** attempt) + (hash(symbol) % 100) / 1000.0)

    try:
        if resp is None or resp.status_code != 200:
            return None

        data = resp.json()
        result = data.get("chart", {}).get("result")
        if not result:
            return None

        result = result[0]
        timestamps = result.get("timestamp", [])
        if not timestamps:
            return None

        quote = result["indicators"]["quote"][0]
        closes = quote.get("close", [])
        opens = quote.get("open", [])
        highs = quote.get("high", [])
        lows = quote.get("low", [])
        volumes = quote.get("volume", [])

        df = pd.DataFrame({
            "Open": opens,
            "High": highs,
            "Low": lows,
            "Close": closes,
            "Volume": volumes,
        }, index=pd.to_datetime(timestamps, unit="s", utc=True))

        # Split/dividend adjustment: Yahoo gives an adjusted close but RAW OHL.
        # Mixing them makes every candle render red (adj close < raw open) and
        # distorts the wicks. Scale Open/High/Low by the same per-bar factor
        # (adjclose / close) so the whole candle is consistently adjusted.
        adjclose_data = result["indicators"].get("adjclose")
        if adjclose_data:
            df["AdjClose"] = adjclose_data[0].get("adjclose", closes)
            factor = df["AdjClose"] / df["Close"]
            factor = factor.replace([float("inf"), float("-inf")], 1.0).fillna(1.0)
            df["Open"]  = df["Open"]  * factor
            df["High"]  = df["High"]  * factor
            df["Low"]   = df["Low"]   * factor
            df["Close"] = df["AdjClose"]
            df = df.drop(columns=["AdjClose"])

        df = df.dropna(subset=["Close"])
        df = df[df["Close"] > 0]
        return df

    except Exception:
        return None
