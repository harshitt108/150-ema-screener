import requests
import pandas as pd
import time
import logging
from typing import Optional

from data_health import inspect_ohlcv

logger = logging.getLogger(__name__)

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

        # NOTE: Yahoo's `adjclose` field is adjusted for BOTH splits and cash
        # dividends. Its raw Open/High/Low/Close are already split-adjusted
        # (continuous across bonus/split events) but NOT dividend-adjusted —
        # which is exactly the convention TradingView/Zerodha use by default,
        # and what NSE's own bhavcopy reports. Previously we overwrote Close
        # with `adjclose` and rescaled Open/High/Low to match, which quietly
        # baked dividend adjustments into every EMA/RSI/signal — e.g. HDFCBANK's
        # 150 EMA came out ~₹13 below TradingView's because of ~₹26.5/share in
        # trailing dividends. Using raw OHLC directly (no rescaling needed —
        # all four fields are already mutually consistent) fixes this.

        # ── Backfill the current/forming bar's live price ─────────────────────
        # Yahoo often leaves the most-recent bar's `close` NULL while the session
        # is live/just-closed, even though the real price sits in
        # meta.regularMarketPrice. Without this, dropna() below would DROP that
        # bar and the chart would show a STALE last candle — e.g. after KPITTECH
        # crashed 671→557 intraday, the chart still read 671. Inject the live
        # price so the forming candle is present and correct on every timeframe.
        meta = result.get("meta", {})
        rmp  = meta.get("regularMarketPrice")
        if rmp and len(df) and pd.isna(df["Close"].iloc[-1]):
            i = df.index[-1]
            if pd.isna(df.at[i, "Open"]):
                df.at[i, "Open"] = rmp
            df.at[i, "Close"] = rmp
            hi = df.at[i, "High"]; lo = df.at[i, "Low"]; op = df.at[i, "Open"]
            df.at[i, "High"] = max([v for v in (hi, op, rmp) if pd.notna(v)])
            df.at[i, "Low"]  = min([v for v in (lo, op, rmp) if pd.notna(v)])

        df = df.dropna(subset=["Close"])
        df = df[df["Close"] > 0]

        # Drop non-trading padding bars: Yahoo emits a flat, zero-volume bar for
        # some holidays (Open==High==Low==Close, volume 0). It renders as a
        # meaningless doji and skews EMAs. Real index bars (volume 0 too) always
        # have a High/Low range, so gating on High==Low leaves them untouched.
        df = df[~((df["Volume"] == 0) & (df["High"] == df["Low"]))]

        # ── Tripwire: validate what we're about to serve ──────────────────────
        # If a NEW kind of Yahoo glitch slips past the repairs above, log it
        # loudly rather than let a chart/scan silently render wrong data.
        problems = inspect_ohlcv(df, symbol, yf_interval)
        if problems:
            logger.warning(
                "[data-health] %s %s served with issues: %s",
                symbol, yf_interval, ",".join(problems),
            )
        return df

    except Exception:
        return None
