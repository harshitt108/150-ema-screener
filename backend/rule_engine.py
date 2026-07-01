"""
Rule engine — evaluates MonitoringRule instances against live EMA and
price-change data.
"""
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from database import MonitoringRule, RuleAlert, Portfolio
from scan_engine import fetch_all_ema_status
from scanner import TIMEFRAME_MAP
from data_fetcher import fetch_ohlcv

logger = logging.getLogger(__name__)

TIMEFRAME_LABELS = {
    "5min": "5 Min", "15min": "15 Min", "30min": "30 Min",
    "1h": "1 Hour",
    "daily": "Daily", "weekly": "Weekly", "monthly": "Monthly",
}

OPERATOR_LABELS = {"gte": "or more", "lte": "or fewer", "eq": "exactly"}

# Minimum gap before the same rule can fire again (prevents spam)
RETRIGGER_HOURS = {"5min": 1, "15min": 1, "30min": 2, "1h": 4,
                   "daily": 20, "weekly": 100, "monthly": 200}


def _should_retrigger(rule: MonitoringRule) -> bool:
    """Return True if enough time has passed since last trigger."""
    if rule.last_triggered_at is None:
        return True
    gap_h = RETRIGGER_HOURS.get(rule.timeframe, 24)
    last = rule.last_triggered_at
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - last >= timedelta(hours=gap_h)


def _eval_operator(value: float, operator: str, threshold: float) -> bool:
    if operator == "gte": return value >= threshold
    if operator == "lte": return value <= threshold
    if operator == "eq":  return abs(value - threshold) < 0.001
    return False


def _pct_change_satisfies(pct: float, direction: str, threshold_value: float) -> bool:
    """direction: 'down' (pct <= -threshold), 'up' (pct >= threshold), 'either' (abs(pct) >= threshold)."""
    if direction == "down":
        return pct <= -threshold_value
    if direction == "up":
        return pct >= threshold_value
    if direction == "either":
        return abs(pct) >= threshold_value
    return False


def fetch_pct_change(symbol: str, timeframe: str) -> Optional[dict]:
    """% change of the latest closed bar vs the previous bar, on `timeframe`.
    Returns {"pct": float, "price": float, "prevPrice": float} or None."""
    if timeframe not in TIMEFRAME_MAP:
        return None
    interval, period = TIMEFRAME_MAP[timeframe]
    try:
        df = fetch_ohlcv(f"{symbol}.NS", interval, period)
    except Exception as e:
        logger.error(f"fetch_pct_change({symbol}, {timeframe}) failed: {e}")
        return None
    if df is None or len(df) < 2:
        return None
    price      = float(df["Close"].iloc[-1])
    prev_price = float(df["Close"].iloc[-2])
    if prev_price == 0:
        return None
    pct = (price - prev_price) / prev_price * 100
    return {"pct": round(pct, 2), "price": round(price, 2), "prevPrice": round(prev_price, 2)}


def _condition_b_satisfies(symbol: str, condition_b: dict) -> tuple[bool, dict]:
    """Evaluate the optional second condition for `symbol`. Returns (satisfies, detail)."""
    metric = condition_b.get("metric")
    tf = condition_b.get("timeframe", "daily")

    if metric == "ema":
        status_map, _ = fetch_all_ema_status([symbol], timeframe=tf)
        st = status_map.get(symbol)
        ema_info = st["ema"].get(str(condition_b.get("ema_period"))) if st else None
        if not ema_info:
            return False, {"metric": "ema", "available": False}
        is_above = ema_info["above"]
        satisfies = (condition_b.get("condition") == "above" and is_above) or \
                    (condition_b.get("condition") == "below" and not is_above)
        return satisfies, {"metric": "ema", "emaPeriod": condition_b.get("ema_period"),
                            "condition": condition_b.get("condition"), "dist": ema_info["dist"],
                            "timeframe": tf}

    if metric == "price_change":
        chg = fetch_pct_change(symbol, tf)
        if not chg:
            return False, {"metric": "price_change", "available": False}
        satisfies = _pct_change_satisfies(chg["pct"], condition_b.get("condition"),
                                           condition_b.get("threshold_value", 0))
        return satisfies, {"metric": "price_change", "condition": condition_b.get("condition"),
                            "threshold": condition_b.get("threshold_value"), "pct": chg["pct"],
                            "timeframe": tf}

    return False, {"metric": metric, "available": False}


def describe_rule(rule: MonitoringRule) -> str:
    """Human-readable one-liner for a rule."""
    tf  = TIMEFRAME_LABELS.get(rule.timeframe, rule.timeframe)
    cnd = rule.condition

    if rule.rule_type == "portfolio_threshold":
        op  = OPERATOR_LABELS.get(rule.operator, rule.operator)
        val = int(rule.threshold_value) if rule.threshold_type == "count" \
              else f"{rule.threshold_value:.0f}%"
        base = f"When {val} stocks {op} are {cnd} {rule.ema_period} EMA on {tf}"
    elif rule.rule_type == "stock_ema":
        sym = rule.symbol or "?"
        base = f"When {sym} is {cnd} {rule.ema_period} EMA on {tf}"
    elif rule.rule_type == "stock_price_change":
        sym = rule.symbol or "?"
        verb = {"down": "drops", "up": "rises", "either": "moves"}.get(cnd, "moves")
        base = f"When {sym} {verb} {rule.threshold_value:.0f}% or more on {tf}"
    elif rule.rule_type == "portfolio_price_change":
        verb = {"down": "drops", "up": "rises", "either": "moves"}.get(cnd, "moves")
        base = f"When any holding {verb} {rule.threshold_value:.0f}% or more on {tf}"
    else:
        base = rule.name

    if rule.condition_b_json and rule.logic_op:
        try:
            cb = json.loads(rule.condition_b_json)
        except (TypeError, ValueError):
            cb = {}
        if cb.get("metric") == "ema":
            cb_desc = f"is {cb.get('condition')} {cb.get('ema_period')} EMA on {TIMEFRAME_LABELS.get(cb.get('timeframe'), cb.get('timeframe'))}"
        elif cb.get("metric") == "price_change":
            verb = {"down": "drops", "up": "rises", "either": "moves"}.get(cb.get("condition"), "moves")
            cb_desc = f"{verb} {cb.get('threshold_value', 0):.0f}% or more on {TIMEFRAME_LABELS.get(cb.get('timeframe'), cb.get('timeframe'))}"
        else:
            cb_desc = "…"
        base = f"{base} {rule.logic_op} {cb_desc}"

    return base


# ─── Core evaluation ──────────────────────────────────────────────────────────

def check_rule(rule: MonitoringRule, db: Session) -> Optional[dict]:
    """
    Evaluate a single rule against live data.
    Returns a violation dict if triggered, None otherwise.
    Stores a RuleAlert row and updates last_triggered_at on trigger.
    """
    if not rule.enabled:
        return None

    portfolio = db.get(Portfolio, rule.portfolio_id)
    if not portfolio or not portfolio.holdings:
        return None

    symbols = list({h.symbol for h in portfolio.holdings})
    now = datetime.now(timezone.utc)

    # Update last_checked_at
    rule.last_checked_at = now

    # EMA data is only needed for the two EMA-based rule types — price-change
    # types fetch their own OHLC independently via fetch_pct_change().
    status_map = {}
    if rule.rule_type in ("portfolio_threshold", "stock_ema"):
        try:
            status_map, _no_data = fetch_all_ema_status(symbols, timeframe=rule.timeframe)
        except Exception as e:
            logger.error(f"[rule {rule.id}] fetch failed: {e}")
            db.commit()
            return None

    period_key = str(rule.ema_period)
    violation: Optional[dict] = None

    # ── Portfolio threshold ────────────────────────────────────────────────
    if rule.rule_type == "portfolio_threshold":
        total     = len([s for s in symbols if s in status_map])
        matching  = 0
        breakdown = []

        for sym in symbols:
            st = status_map.get(sym)
            if not st:
                continue
            ema_info = st["ema"].get(period_key)
            if not ema_info:
                continue
            is_above = ema_info["above"]
            satisfies = (rule.condition == "above" and is_above) or \
                        (rule.condition == "below" and not is_above)
            if satisfies:
                matching += 1
                breakdown.append({
                    "symbol": sym,
                    "price": st["currentPrice"],
                    "ema":   ema_info["value"],
                    "dist":  ema_info["dist"],
                })

        check_val = matching if rule.threshold_type == "count" \
                    else (matching / total * 100 if total > 0 else 0)

        if _eval_operator(check_val, rule.operator, rule.threshold_value):
            violation = {
                "ruleId":        rule.id,
                "ruleName":      rule.name,
                "ruleType":      "portfolio_threshold",
                "timeframe":     rule.timeframe,
                "emaPeriod":     rule.ema_period,
                "condition":     rule.condition,
                "matching":      matching,
                "total":         total,
                "checkValue":    round(check_val, 1),
                "thresholdType": rule.threshold_type,
                "threshold":     rule.threshold_value,
                "operator":      rule.operator,
                "breakdown":     breakdown[:20],   # cap list
                "description":   describe_rule(rule),
            }

    # ── Individual stock EMA / % price change ──────────────────────────────
    # Both are single-symbol, single-condition primary checks that can be
    # combined with an optional condition B — so the primary payload and its
    # satisfies flag are computed unconditionally, and the fire decision is
    # deferred to the combine step below (needed for correct OR semantics:
    # a rule should also fire when ONLY condition B is true).
    elif rule.rule_type in ("stock_ema", "stock_price_change"):
        sym = rule.symbol
        if not sym:
            db.commit()
            return None

        primary_satisfies = False
        primary_payload = None

        if rule.rule_type == "stock_ema":
            st = status_map.get(sym)
            ema_info = st["ema"].get(period_key) if st else None
            if st and ema_info:
                is_above = ema_info["above"]
                primary_satisfies = (rule.condition == "above" and is_above) or \
                                    (rule.condition == "below" and not is_above)
                primary_payload = {
                    "ruleId":       rule.id,
                    "ruleName":     rule.name,
                    "ruleType":     "stock_ema",
                    "timeframe":    rule.timeframe,
                    "emaPeriod":    rule.ema_period,
                    "condition":    rule.condition,
                    "symbol":       sym,
                    "currentPrice": st["currentPrice"],
                    "emaValue":     ema_info["value"],
                    "dist":         ema_info["dist"],
                    "description":  describe_rule(rule),
                }
        else:
            chg = fetch_pct_change(sym, rule.timeframe)
            if chg:
                primary_satisfies = _pct_change_satisfies(chg["pct"], rule.condition, rule.threshold_value)
                primary_payload = {
                    "ruleId":       rule.id,
                    "ruleName":     rule.name,
                    "ruleType":     "stock_price_change",
                    "timeframe":    rule.timeframe,
                    "condition":    rule.condition,
                    "threshold":    rule.threshold_value,
                    "symbol":       sym,
                    "currentPrice": chg["price"],
                    "prevPrice":    chg["prevPrice"],
                    "pctChange":    chg["pct"],
                    "description":  describe_rule(rule),
                }

        if primary_payload is None:
            db.commit()
            return None

        # No condition B — behave exactly as before (fire iff primary is true)
        condition_b = None
        if rule.condition_b_json and rule.logic_op:
            try:
                condition_b = json.loads(rule.condition_b_json)
            except (TypeError, ValueError):
                condition_b = None

        if not condition_b:
            violation = primary_payload if primary_satisfies else None
        else:
            satisfies_b, detail_b = _condition_b_satisfies(sym, condition_b)
            combined = (primary_satisfies and satisfies_b) if rule.logic_op == "AND" \
                       else (primary_satisfies or satisfies_b)
            if combined:
                violation = dict(primary_payload)
                violation["conditionB"] = detail_b
                violation["logicOp"]    = rule.logic_op

    # ── Any-holding % price change ─────────────────────────────────────────
    elif rule.rule_type == "portfolio_price_change":
        breakdown = []
        with ThreadPoolExecutor(max_workers=10) as ex:
            changes = dict(zip(symbols, ex.map(lambda s: fetch_pct_change(s, rule.timeframe), symbols)))

        for sym in symbols:
            chg = changes.get(sym)
            if not chg:
                continue
            if _pct_change_satisfies(chg["pct"], rule.condition, rule.threshold_value):
                breakdown.append({
                    "symbol":    sym,
                    "price":     chg["price"],
                    "prevPrice": chg["prevPrice"],
                    "pctChange": chg["pct"],
                })

        if breakdown:
            violation = {
                "ruleId":     rule.id,
                "ruleName":   rule.name,
                "ruleType":   "portfolio_price_change",
                "timeframe":  rule.timeframe,
                "condition":  rule.condition,
                "threshold":  rule.threshold_value,
                "breakdown":  breakdown[:20],
                "description": describe_rule(rule),
            }

    # ── Persist if triggered ──────────────────────────────────────────────
    if violation:
        if _should_retrigger(rule):
            rule.last_triggered_at = now
            db.add(RuleAlert(
                rule_id      = rule.id,
                portfolio_id = rule.portfolio_id,
                triggered_at = now,
                details_json = json.dumps(violation),
                email_sent   = False,
            ))
            logger.info(f"[rule {rule.id}] '{rule.name}' triggered")
        else:
            # Condition met but within cooldown — return violation without storing
            logger.debug(f"[rule {rule.id}] triggered but within cooldown")

    db.commit()
    return violation


def check_all_rules(portfolio_id: int, db: Session) -> list[dict]:
    """Check every enabled rule for a portfolio. Returns list of violations."""
    rules = (
        db.query(MonitoringRule)
        .filter(MonitoringRule.portfolio_id == portfolio_id,
                MonitoringRule.enabled == True)
        .all()
    )
    violations = []
    for rule in rules:
        result = check_rule(rule, db)
        if result:
            violations.append(result)
    return violations
