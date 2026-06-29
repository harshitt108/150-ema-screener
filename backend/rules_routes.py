from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import json
import logging
from datetime import datetime, timezone

from database import get_db, Portfolio, MonitoringRule, RuleAlert
from rule_engine import check_rule, check_all_rules, describe_rule

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rules", tags=["rules"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class RuleCreate(BaseModel):
    name:            str
    rule_type:       str            # portfolio_threshold | stock_ema
    timeframe:       str
    ema_period:      int
    condition:       str            # above | below
    # portfolio_threshold
    operator:        Optional[str]  = None   # gte | lte | eq
    threshold_type:  Optional[str]  = None   # count | percent
    threshold_value: Optional[float]= None
    # stock_ema
    symbol:          Optional[str]  = None
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
    enabled:         Optional[bool]  = None


# ─── Serializer ──────────────────────────────────────────────────────────────

def _rule_dict(r: MonitoringRule) -> dict:
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
        "enabled":          r.enabled,
        "createdAt":        r.created_at.isoformat() if r.created_at else None,
        "lastCheckedAt":    r.last_checked_at.isoformat() if r.last_checked_at else None,
        "lastTriggeredAt":  r.last_triggered_at.isoformat() if r.last_triggered_at else None,
        "description":      describe_rule(r),
    }


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


@router.post("/portfolio/{portfolio_id}")
def create_rule(portfolio_id: int, body: RuleCreate, db: Session = Depends(get_db)):
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # Validate
    if body.rule_type == "portfolio_threshold":
        if body.operator is None or body.threshold_type is None or body.threshold_value is None:
            raise HTTPException(status_code=400,
                detail="portfolio_threshold rules require operator, threshold_type, threshold_value")
    elif body.rule_type == "stock_ema":
        if not body.symbol:
            raise HTTPException(status_code=400, detail="stock_ema rules require symbol")
    else:
        raise HTTPException(status_code=400, detail=f"Unknown rule_type: {body.rule_type}")

    rule = MonitoringRule(
        portfolio_id    = portfolio_id,
        name            = body.name,
        rule_type       = body.rule_type,
        timeframe       = body.timeframe,
        ema_period      = body.ema_period,
        condition       = body.condition,
        operator        = body.operator,
        threshold_type  = body.threshold_type,
        threshold_value = body.threshold_value,
        symbol          = body.symbol.upper() if body.symbol else None,
        enabled         = body.enabled,
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
    for field, val in body.model_dump(exclude_none=True).items():
        # Convert camelCase pydantic to snake_case column
        col = field  # already snake_case in pydantic body
        if hasattr(rule, col):
            setattr(rule, col, val)
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
