"""
Core scan logic shared by the API refresh endpoint and the background scheduler.
"""
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from data_fetcher import fetch_ohlcv
from scanner import calculate_ema, TIMEFRAME_MAP
from health_score import calculate_health_score, detect_crosses
from database import Portfolio, ScanResult, SentAlert

logger = logging.getLogger(__name__)


# ─── Low-level EMA fetch ──────────────────────────────────────────────────────

def _fetch_ema_status(symbol: str, timeframe: str = "daily") -> dict:
    """Fetch OHLCV and return EMA snapshot for 20/50/150/200."""
    symbol = symbol.upper().strip().replace(" ", "")
    interval, period = TIMEFRAME_MAP.get(timeframe, TIMEFRAME_MAP["daily"])
    df = fetch_ohlcv(f"{symbol}.NS", interval, period)
    if df is None or len(df) < 20:
        return {"symbol": symbol, "error": "no_data"}

    close = df["Close"]
    current_price = round(float(close.iloc[-1]), 2)
    result: dict = {"symbol": symbol, "currentPrice": current_price, "ema": {}}

    for p in (20, 50, 150, 200):
        if len(close) >= p:
            ema_val = float(calculate_ema(close, p).iloc[-1])
            dist = (current_price - ema_val) / ema_val * 100
            result["ema"][str(p)] = {
                "value": round(ema_val, 2),
                "above": current_price > ema_val,
                "dist":  round(dist, 2),
            }

    # Momentum (RSI > 50, MACD > Signal, Aroon) — same indicators the scanner
    # shows, so the Portfolio/Watchlist tables can display them consistently.
    try:
        from indicators import compute_signals
        conds = compute_signals(df, ratio=None).get("conditions", {})
        def _m(key):
            c = conds.get(key)
            return {"bull": bool(c["bull"]), "val": c["val"]} if c else None
        result["momentum"] = {
            "rsi":   _m("rsi_gt_50"),
            "macd":  _m("macd_gt_signal"),
            "aroon": _m("aroon_bull"),
        }
    except Exception:
        result["momentum"] = None
    return result


def fetch_ratio_conditions(symbols: list[str], timeframe: str = "daily", benchmark: str = "NIFTY 50") -> dict:
    """Compute ratio (price/benchmark) EMA conditions for each symbol.
    Returns {symbol: {ema20: {above, dist}, ema50: ..., ema150: ...}}
    Benchmark data is fetched once and reused across all symbols.
    """
    from rs_scanner import BENCHMARK_MAP, _compute_ratio

    interval, period = TIMEFRAME_MAP.get(timeframe, TIMEFRAME_MAP["daily"])
    bench_yahoo = BENCHMARK_MAP.get(benchmark)
    if not bench_yahoo:
        return {}

    bench_df = fetch_ohlcv(bench_yahoo, interval, period)
    if bench_df is None or len(bench_df) < 20:
        return {}

    result: dict = {}

    def _one(sym: str):
        df = fetch_ohlcv(f"{sym}.NS", interval, period)
        if df is None or len(df) < 20:
            return sym, None
        ratio = _compute_ratio(df, bench_df, interval)
        if ratio is None or len(ratio) < 20:
            return sym, None
        cur = float(ratio.iloc[-1])
        conds: dict = {}
        for p in (20, 50, 150):
            if len(ratio) >= p:
                ema_v = float(calculate_ema(ratio, p).iloc[-1])
                if ema_v != 0:
                    dist = (cur - ema_v) / ema_v * 100
                    conds[f"ema{p}"] = {"above": bool(cur > ema_v), "dist": round(dist, 2)}
        return sym, conds if conds else None

    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(_one, sym): sym for sym in symbols}
        for future in as_completed(futures):
            sym, conds = future.result()
            if conds:
                result[sym] = conds

    return result


def fetch_all_ema_status(symbols: list[str], timeframe: str = "daily") -> tuple[dict, list[str]]:
    """Concurrently fetch EMA status for a list of symbols on a given timeframe.
    Returns (status_map, no_data_list).
    """
    status_map: dict = {}
    no_data: list[str] = []

    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(_fetch_ema_status, sym, timeframe): sym for sym in symbols}
        for future in as_completed(futures):
            result = future.result()
            sym = result["symbol"]
            if "error" in result:
                no_data.append(sym)
            else:
                status_map[sym] = result

    return status_map, no_data


# ─── Full portfolio scan ──────────────────────────────────────────────────────

def scan_portfolio(portfolio_id: int, db: Session) -> Optional[dict]:
    """
    Full scan for one portfolio:
      1. Fetch fresh EMA data for all holdings
      2. Compute health score
      3. Compare with previous scan → detect EMA crosses
      4. Persist ScanResult + SentAlert rows
      5. Return result dict (no email — caller decides whether to send)
    """
    p = db.get(Portfolio, portfolio_id)
    if not p:
        return None

    symbols = list({h.symbol for h in p.holdings})
    if not symbols:
        return {"portfolioId": portfolio_id, "status": {}, "health": None,
                "crosses": [], "noData": []}

    logger.info(f"[scan] portfolio={portfolio_id} ({p.name}) — {len(symbols)} symbols")
    status_map, no_data = fetch_all_ema_status(symbols)

    # Health score
    health = calculate_health_score(status_map)

    # Detect crosses vs last scan
    prev_scan = (
        db.query(ScanResult)
        .filter(ScanResult.portfolio_id == portfolio_id)
        .order_by(ScanResult.scanned_at.desc())
        .first()
    )
    prev_status = json.loads(prev_scan.status_json) if prev_scan else {}
    crosses = detect_crosses(prev_status, status_map)

    now = datetime.now(timezone.utc)

    # Persist scan result
    scan_row = ScanResult(
        portfolio_id    = portfolio_id,
        scanned_at      = now,
        status_json     = json.dumps(status_map),
        health_score    = health["score"],
        health_category = health["category"],
        health_details  = json.dumps(health),
        no_data_json    = json.dumps(no_data),
    )
    db.add(scan_row)

    # Persist each cross as an alert record
    for cross in crosses:
        db.add(SentAlert(
            portfolio_id  = portfolio_id,
            symbol        = cross["symbol"],
            alert_type    = cross["alert_type"],
            triggered_at  = now,
            current_price = cross.get("currentPrice"),
            ema_value     = cross.get("ema_value"),
            distance_pct  = cross.get("dist"),
            email_sent    = False,
        ))

    db.commit()

    # Check custom monitoring rules (imported here to avoid circular import)
    from rule_engine import check_all_rules
    rule_violations = check_all_rules(portfolio_id, db)

    logger.info(
        f"[scan] portfolio={portfolio_id} score={health['score']} "
        f"({health['category']}) crosses={len(crosses)} rule_violations={len(rule_violations)}"
    )

    return {
        "portfolioId":    portfolio_id,
        "scannedAt":      now.isoformat(),
        "status":         status_map,
        "health":         health,
        "crosses":        crosses,
        "noData":         no_data,
        "ruleViolations": rule_violations,
    }


def scan_all_portfolios(db: Session) -> list[dict]:
    """Scan every portfolio. Used by the scheduler."""
    portfolios = db.query(Portfolio).all()
    results = []
    for p in portfolios:
        if not p.holdings:
            continue
        result = scan_portfolio(p.id, db)
        if result:
            results.append(result)
    return results
