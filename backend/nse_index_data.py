"""
NSE-archive data source for the ~18 NIFTY sector/thematic indices that Yahoo
Finance has stopped serving historical data for (confirmed Jul 2026 — Yahoo
returns a single live-quote bar for ^CNXAUTO and similar tickers regardless of
the requested range, while stocks and other indices like NIFTY Bank/IT/Pharma
are unaffected). See scanner-data-validation memory for the investigation.

Pulls NSE's own public "closing price of all indices" daily archive at
nsearchives.nseindia.com — a *different* subdomain from www.nseindia.com,
which bot-blocks (403) non-browser requests; the archive host has no such
gate and needs no session/cookies. One CSV file covers every NSE index for a
single trading day, so building N years of history means downloading N years
of daily files ONCE (not once per index) and slicing per index from a shared
in-memory cache.

Daily data only — NSE's archive has no intraday granularity. Weekly/Monthly
series are derived by resampling the cached daily series (so their EMA depth
is limited to the cached window, unlike Yahoo-sourced indices' 10-20y).
"""
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from io import StringIO
from typing import Optional

import pandas as pd
import requests

logger = logging.getLogger(__name__)

_ARCHIVE_URL = "https://nsearchives.nseindia.com/content/indices/ind_close_all_{date}.csv"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}

# Our display name -> NSE's exact "Index Name" string in the archive CSV.
# Verified against a live archive file — only these 18 (the ones confirmed
# dead on Yahoo) route here; every other index keeps using Yahoo unchanged.
NSE_INDEX_NAME = {
    "NIFTY Next 50":       "Nifty Next 50",
    "NIFTY Midcap 100":    "NIFTY Midcap 100",
    "NIFTY Auto":          "Nifty Auto",
    "NIFTY FMCG":          "Nifty FMCG",
    "NIFTY Metal":         "Nifty Metal",
    "NIFTY Realty":        "Nifty Realty",
    "NIFTY Energy":        "Nifty Energy",
    "NIFTY Media":         "Nifty Media",
    "NIFTY PSU Bank":      "Nifty PSU Bank",
    "NIFTY Fin Services":  "Nifty Financial Services",
    "NIFTY Private Bank":  "Nifty Private Bank",
    "NIFTY Infra":         "Nifty Infrastructure",
    "NIFTY Commodities":   "Nifty Commodities",
    "NIFTY Consumption":   "Nifty India Consumption",
    "NIFTY PSE":           "Nifty PSE",
    "NIFTY MNC":           "Nifty MNC",
    "NIFTY Services":      "Nifty Services Sector",
    "NIFTY Dividend Opps": "Nifty Dividend Opportunities 50",
}

_YEARS_BACK = 2                  # matches Yahoo's own "daily" period for parity
_MAX_WORKERS = 12
_CACHE_TTL_SECONDS = 4 * 3600    # NSE publishes once/day after close — no need to refetch often

_cache_lock = threading.Lock()
_cache = {"built_at": 0.0, "long_df": None}   # long-format: one row per (index, day)


def _fetch_day(date) -> Optional[pd.DataFrame]:
    """One day's 'all indices' archive file, or None (weekend/holiday/network)."""
    url = _ARCHIVE_URL.format(date=date.strftime("%d%m%Y"))
    try:
        r = requests.get(url, headers=_HEADERS, timeout=12)
    except requests.RequestException:
        return None
    if r.status_code != 200 or not r.text.strip():
        return None
    try:
        df = pd.read_csv(StringIO(r.text))
    except Exception:
        return None
    df.columns = [c.strip() for c in df.columns]
    return df


def _build_history() -> pd.DataFrame:
    """Download ~2 years of daily 'all indices' files and stack them into one
    long-format frame. Weekends are skipped outright; holiday 404s are just
    dropped — a handful of missing trading days doesn't affect EMA settling."""
    end = datetime.utcnow().date()
    start = end - timedelta(days=365 * _YEARS_BACK)
    dates = [start + timedelta(days=i) for i in range((end - start).days + 1)
             if (start + timedelta(days=i)).weekday() < 5]

    frames = []
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
        futures = [executor.submit(_fetch_day, d) for d in dates]
        for future in as_completed(futures):
            df = future.result()
            if df is not None and len(df):
                frames.append(df)

    if not frames:
        logger.warning("[nse-index] archive build returned zero days — nsearchives.nseindia.com may be unreachable")
        return pd.DataFrame(columns=["Index Name", "_date", "Open Index Value", "High Index Value",
                                      "Low Index Value", "Closing Index Value", "Volume"])

    combined = pd.concat(frames, ignore_index=True)
    combined["_date"] = pd.to_datetime(combined["Index Date"], format="%d-%m-%Y", utc=True)
    return combined


def _get_history() -> pd.DataFrame:
    """Combined archive history, cached in memory and rebuilt at most every
    _CACHE_TTL_SECONDS (~500 HTTP requests, so this is not something to redo
    on every dashboard refresh)."""
    with _cache_lock:
        stale = (time.time() - _cache["built_at"]) > _CACHE_TTL_SECONDS
        if _cache["long_df"] is None or stale:
            logger.info("[nse-index] building NSE archive cache (%d indices, %dy)...",
                        len(NSE_INDEX_NAME), _YEARS_BACK)
            t0 = time.time()
            _cache["long_df"] = _build_history()
            _cache["built_at"] = time.time()
            logger.info("[nse-index] cache built in %.1fs (%d index-day rows)",
                        time.time() - t0, len(_cache["long_df"]))
        return _cache["long_df"]


def get_index_ohlcv(display_name: str, interval: str = "1d") -> Optional[pd.DataFrame]:
    """OHLCV for one of the 18 NSE-sourced indices, shaped like
    data_fetcher.fetch_ohlcv's output (Open/High/Low/Close/Volume columns,
    tz-aware UTC DatetimeIndex) so it's a drop-in for every downstream
    computation (EMA, RSI, ratio-vs-benchmark, etc).

    interval: '1d' (native) or '1wk'/'1mo' (resampled from the cached daily
    series). Intraday ('5m'/'15m'/'30m'/'1h') isn't available from NSE's
    archive — returns None, same as these indices already do on Yahoo today.
    """
    nse_name = NSE_INDEX_NAME.get(display_name)
    if nse_name is None:
        return None

    hist = _get_history()
    if hist.empty:
        return None
    rows = hist[hist["Index Name"].str.strip() == nse_name]
    if rows.empty:
        return None

    df = rows.set_index("_date").sort_index()
    out = pd.DataFrame({
        "Open":   pd.to_numeric(df["Open Index Value"], errors="coerce"),
        "High":   pd.to_numeric(df["High Index Value"], errors="coerce"),
        "Low":    pd.to_numeric(df["Low Index Value"], errors="coerce"),
        "Close":  pd.to_numeric(df["Closing Index Value"], errors="coerce"),
        "Volume": pd.to_numeric(df.get("Volume", 0), errors="coerce").fillna(0),
    })
    out = out[~out.index.duplicated(keep="last")].dropna(subset=["Close"])

    if interval == "1d":
        return out
    rule = {"1wk": "W", "1mo": "ME"}.get(interval)
    if rule is None:
        return None
    resampled = out.resample(rule).agg({
        "Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum",
    }).dropna(subset=["Close"])
    return resampled
