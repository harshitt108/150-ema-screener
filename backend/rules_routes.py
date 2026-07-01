from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import json
import logging
from datetime import datetime, timezone

from database import get_db, Portfolio, MonitoringRule, RuleAlert
from rule_engine import check_rule, check_all_rules, describe_rule
from rule_templates import RULE_TEMPLATES

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rules", tags=["rules"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class ConditionB(BaseModel):
    metric:          str             # ema | price_change
    timeframe:       str
    condition:       str             # above|below (ema) or up|down|either (price_change)
    ema_period:      Optional[int]   = None   # required when metric == "ema"
    threshold_value: Optional[float] = None   # required when metric == "price_change"


class RuleCreate(BaseModel):
    name:            str
    rule_type:       str             # portfolio_threshold | stock_ema | stock_price_change | portfolio_price_change
    timeframe:       str
    ema_period:      Optional[int] = 0   # unused (0) for *_price_change rule types
    condition:       str             # above|below (ema types) or up|down|either (price_change types)
    # portfolio_threshold
    operator:        Optional[str]  = None   # gte | lte | eq
    threshold_type:  Optional[str]  = None   # count | percent
    threshold_value: Optional[float]= None   # also the %Chg threshold for *_price_change
    # stock_ema / stock_price_change
    symbol:          Optional[str]  = None
    # optional second condition (AND/OR), same symbol, stock_ema/stock_price_change only
    condition_b:     Optional[ConditionB] = None
    logic_op:        Optional[str]  = None   # AND | OR — required if condition_b is set
    enabled:         bool           = True

class RuleUpdate(BaseModel):
    name:            Optional[str]   = None
    timeframe:       Optional[str]   = None
    ema_period:      Optional[int]   = None
    condition:       Optional[str]   = None
    operator:        Optional[str]   = None
    threshold_type:  Optional[str]   = None
    threshold_value: Optional[float] = None
    symbol:          Optional[str]   = None
    condition_b:     Optional[ConditionB] = None
    logic_op:        Optional[str]   = None
    enabled:         Optional[bool]  = None


# ─── Serializer ──────────────────────────────────────────────────────────────

def _rule_dict(r: MonitoringRule) -> dict:
    condition_b = None
    if r.condition_b_json:
        try:
            condition_b = json.loads(r.condition_b_json)
        except (TypeError, ValueError):
            condition_b = None
    return {
        "id":               r.id,
        "portfolioId":      r.portfolio_id,
        "name":             r.name,
        "ruleType":         r.rule_type,
        "timeframe":        r.timeframe,
        "emaPeriod":        r.ema_period,
        "condition":        r.condition,
        "operator":         r.operator,
        "thresholdType":    r.threshold_type,
        "thresholdValue":   r.threshold_value,
        "symbol":           r.symbol,
        "conditionB":       condition_b,
        "logicOp":          r.logic_op,
        "enabled":          r.enabled,
        "createdAt":        r.created_at.isoformat() if r.created_at else None,
        "lastCheckedAt":    r.last_checked_at.isoformat() if r.last_checked_at else None,
        "lastTriggeredAt":  r.last_triggered_at.isoformat() if r.last_triggered_at else None,
        "description":      describe_rule(r),
    }


# ─── Templates ────────────────────────────────────────────────────────────────

@router.get("/templates")
def list_templates():
    """Starter rule presets for the builder — see rule_templates.py."""
    return {"templates": RULE_TEMPLATES}


# ─── CRUD ─────────────────────────────────────────────────────────────────────

@router.get("/portfolio/{portfolio_id}")
def list_rules(portfolio_id: int, db: Session = Depends(get_db)):
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    rules = (
        db.query(MonitoringRule)
        .filter(MonitoringRule.portfolio_id == portfolio_id)
        .order_by(MonitoringRule.created_at)
        .all()
    )
    return [_rule_dict(r) for r in rules]


VALID_RULE_TYPES = {"portfolio_threshold", "stock_ema", "stock_price_change", "portfolio_price_change"}
# rule_types that support an optional second condition (always same-symbol)
COMBINABLE_RULE_TYPES = {"stock_ema", "stock_price_change"}


def _validate_rule_body(body) -> None:
    if body.rule_type not in VALID_RULE_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown rule_type: {body.rule_type}")

    if body.rule_type == "portfolio_threshold":
        if body.operator is None or body.threshold_type is None or body.threshold_value is None:
            raise HTTPException(status_code=400,
                detail="portfolio_threshold rules require operator, threshold_type, threshold_value")
    elif body.rule_type == "stock_ema":
        if not body.symbol:
            raise HTTPException(status_code=400, detail="stock_ema rules require symbol")
    elif body.rule_type == "stock_price_change":
        if not body.symbol:
            raise HTTPException(status_code=400, detail="stock_price_change rules require symbol")
        if body.threshold_value is None:
            raise HTTPException(status_code=400, detail="stock_price_change rules require threshold_value")
    elif body.rule_type == "portfolio_price_change":
        if body.threshold_value is None:
            raise HTTPException(status_code=400, detail="portfolio_price_change rules require threshold_value")

    if body.condition_b is not None:
        if body.rule_type not in COMBINABLE_RULE_TYPES:
            raise HTTPException(status_code=400,
                detail=f"condition_b is only supported for rule types: {', '.join(COMBINABLE_RULE_TYPES)}")
        if body.logic_op not in ("AND", "OR"):
            raise HTTPException(status_code=400, detail="logic_op must be 'AND' or 'OR' when condition_b is set")
        if body.condition_b.metric == "ema" and body.condition_b.ema_period is None:
            raise HTTPException(status_code=400, detail="condition_b with metric 'ema' requires ema_period")
        if body.condition_b.metric == "price_change" and body.condition_b.threshold_value is None:
            raise HTTPException(status_code=400, detail="condition_b with metric 'price_change' requires threshold_value")


@router.post("/portfolio/{portfolio_id}")
def create_rule(portfolio_id: int, body: RuleCreate, db: Session = Depends(get_db)):
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    _validate_rule_body(body)

    rule = MonitoringRule(
        portfolio_id     = portfolio_id,
        name             = body.name,
        rule_type        = body.rule_type,
        timeframe        = body.timeframe,
        ema_period       = body.ema_period or 0,
        condition        = body.condition,
        operator         = body.operator,
        threshold_type   = body.threshold_type,
        threshold_value  = body.threshold_value,
        symbol           = body.symbol.upper() if body.symbol else None,
        condition_b_json = json.dumps(body.condition_b.model_dump()) if body.condition_b else None,
        logic_op         = body.logic_op if body.condition_b else None,
        enabled          = body.enabled,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _rule_dict(rule)


@router.put("/{rule_id}")
def update_rule(rule_id: int, body: RuleUpdate, db: Session = Depends(get_db)):
    rule = db.get(MonitoringRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    updates = body.model_dump(exclude_none=True, exclude={"condition_b"})
    for field, val in updates.items():
        if hasattr(rule, field):
            setattr(rule, field, val)

    # condition_b/logic_op need custom handling: model attribute is condition_b_json,
    # and clearing condition_b (setting it to null) must also clear logic_op.
    if "condition_b" in body.model_fields_set:
        if body.condition_b is not None:
            rule.condition_b_json = json.dumps(body.condition_b.model_dump())
            rule.logic_op = body.logic_op or rule.logic_op or "AND"
        else:
            rule.condition_b_json = None
            rule.logic_op = None
    db.commit()
    db.refresh(rule)
    return _rule_dict(rule)


@router.delete("/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.get(MonitoringRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()
    return {"ok": True}


# ─── Check endpoints ──────────────────────────────────────────────────────────

@router.post("/{rule_id}/check")
def check_one_rule(rule_id: int, db: Session = Depends(get_db)):
    """Manually evaluate a single rule against live data right now."""
    rule = db.get(MonitoringRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    violation = check_rule(rule, db)
    return {
        "triggered":  violation is not None,
        "violation":  violation,
        "checkedAt":  rule.last_checked_at.isoformat() if rule.last_checked_at else None,
    }


@router.post("/portfolio/{portfolio_id}/check-all")
def check_all(portfolio_id: int, db: Session = Depends(get_db)):
    """Evaluate all enabled rules for a portfolio against live data."""
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    violations = check_all_rules(portfolio_id, db)
    return {"violations": violations, "count": len(violations)}


# ─── Rule alert history ───────────────────────────────────────────────────────

@router.get("/{rule_id}/alerts")
def rule_alert_history(rule_id: int, limit: int = 20, db: Session = Depends(get_db)):
    rule = db.get(MonitoringRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    rows = (
        db.query(RuleAlert)
        .filter(RuleAlert.rule_id == rule_id)
        .order_by(RuleAlert.triggered_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id":          r.id,
            "triggeredAt": r.triggered_at.isoformat(),
            "details":     json.loads(r.details_json) if r.details_json else None,
            "emailSent":   r.email_sent,
        }
        for r in rows
    ]
