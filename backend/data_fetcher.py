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
    "2h":   "90m",   # Yahoo has no 2h interval; 90m is the closest supported option
    "4h":   "1d",    # Yahoo has no 4h interval; fall back to daily
    "1d":   "1d",
    "1wk":  "1wk",
    "1mo":  "1mo",
}

YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"


def fetch_ohlcv(symbol: str, interval: str, period: str) -> Optional[pd.DataFrame]:
    yf_interval = INTERVAL_MAP.get(interval, interval)

    url = f"{YAHOO_BASE}/{symbol}"
    params = {
        "interval": yf_interval,
        "range": period,
        "includePrePost": "false",
        "events": "div,splits",
    }

    try:
        resp = SESSION.get(url, params=params, timeout=15)
        if resp.status_code != 200:
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

        # Handle adjclose
        adjclose_data = result["indicators"].get("adjclose")
        if adjclose_data:
            adj = adjclose_data[0].get("adjclose", closes)
        else:
            adj = closes

        df = pd.DataFrame({
            "Open": opens,
            "High": highs,
            "Low": lows,
            "Close": adj,
            "Volume": volumes,
        }, index=pd.to_datetime(timestamps, unit="s", utc=True))

        df = df.dropna(subset=["Close"])
        df = df[df["Close"] > 0]
        return df

    except Exception:
        return None
