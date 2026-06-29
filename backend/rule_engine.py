"""
Rule engine — evaluates MonitoringRule instances against live EMA data.
"""
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from database import MonitoringRule, RuleAlert, Portfolio
from scan_engine import fetch_all_ema_status

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


def describe_rule(rule: MonitoringRule) -> str:
    """Human-readable one-liner for a rule."""
    tf  = TIMEFRAME_LABELS.get(rule.timeframe, rule.timeframe)
    cnd = rule.condition  # above | below

    if rule.rule_type == "portfolio_threshold":
        op  = OPERATOR_LABELS.get(rule.operator, rule.operator)
        val = int(rule.threshold_value) if rule.threshold_type == "count" \
              else f"{rule.threshold_value:.0f}%"
        return f"When {val} stocks {op} are {cnd} {rule.ema_period} EMA on {tf}"
    else:
        sym = rule.symbol or "?"
        return f"When {sym} is {cnd} {rule.ema_period} EMA on {tf}"


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

    # Fetch live EMA data for this timeframe
    try:
        status_map, no_data = fetch_all_ema_status(symbols, timeframe=rule.timeframe)
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

    # ── Individual stock EMA ───────────────────────────────────────────────
    elif rule.rule_type == "stock_ema":
        sym = rule.symbol
        if not sym:
            db.commit()
            return None

        st = status_map.get(sym)
        if not st:
            db.commit()
            return None

        ema_info = st["ema"].get(period_key)
        if not ema_info:
            db.commit()
            return None

        is_above   = ema_info["above"]
        satisfies  = (rule.condition == "above" and is_above) or \
                     (rule.condition == "below" and not is_above)

        if satisfies:
            violation = {
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
