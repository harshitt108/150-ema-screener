from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import json
import logging

from database import (
    get_db, Portfolio, ScanResult, SentAlert,
    AlertSettings, EmailConfig
)
from scan_engine import scan_portfolio
from alert_service import send_portfolio_alerts, send_email, build_html_email

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class EmailConfigBody(BaseModel):
    smtp_host:     str  = "smtp.gmail.com"
    smtp_port:     int  = 587
    smtp_user:     str
    smtp_password: str
    from_name:     str  = "Portfolio Guardian"

class AlertSettingsBody(BaseModel):
    recipient_email:       Optional[str]  = None
    email_enabled:         bool           = False
    alert_cross_below_20:  bool           = False
    alert_cross_below_50:  bool           = False
    alert_cross_below_150: bool           = True
    alert_cross_below_200: bool           = False
    alert_cross_above_150: bool           = False


# ─── Email config (global) ────────────────────────────────────────────────────

@router.get("/email-config")
def get_email_config(db: Session = Depends(get_db)):
    cfg = db.query(EmailConfig).first()
    if not cfg:
        return {"configured": False}
    return {
        "configured":  bool(cfg.smtp_user),
        "smtp_host":   cfg.smtp_host,
        "smtp_port":   cfg.smtp_port,
        "smtp_user":   cfg.smtp_user,
        "smtp_password": "••••••••" if cfg.smtp_password else "",
        "from_name":   cfg.from_name,
    }


@router.put("/email-config")
def save_email_config(body: EmailConfigBody, db: Session = Depends(get_db)):
    cfg = db.query(EmailConfig).first()
    if not cfg:
        cfg = EmailConfig()
        db.add(cfg)
    cfg.smtp_host     = body.smtp_host
    cfg.smtp_port     = body.smtp_port
    cfg.smtp_user     = body.smtp_user
    cfg.smtp_password = body.smtp_password
    cfg.from_name     = body.from_name
    db.commit()
    return {"ok": True}


@router.post("/test-email")
def test_email(body: dict, db: Session = Depends(get_db)):
    to_email = body.get("to_email")
    if not to_email:
        raise HTTPException(status_code=400, detail="to_email required")
    cfg = db.query(EmailConfig).first()
    if not cfg or not cfg.smtp_user:
        raise HTTPException(status_code=400, detail="SMTP not configured")
    html = build_html_email(
        portfolio_name="Test Portfolio",
        crosses=[{
            "symbol": "RELIANCE", "period": 150, "direction": "below",
            "alert_type": "cross_below_150",
            "currentPrice": 1300.0, "ema_value": 1377.46, "dist": -5.62
        }],
        health={"score": 72, "category": "Watch", "above150": 3, "total": 5},
    )
    ok = send_email(cfg, to_email, "📊 Portfolio Guardian — Test Email", html)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to send. Check SMTP credentials.")
    return {"ok": True}


# ─── Per-portfolio alert settings ─────────────────────────────────────────────

@router.get("/portfolio-settings/{portfolio_id}")
def get_portfolio_settings(portfolio_id: int, db: Session = Depends(get_db)):
    s = db.query(AlertSettings).filter_by(portfolio_id=portfolio_id).first()
    if not s:
        return {
            "portfolioId": portfolio_id,
            "recipientEmail": None, "emailEnabled": False,
            "alertCrossBelow20": False, "alertCrossBelow50": False,
            "alertCrossBelow150": True,  "alertCrossBelow200": False,
            "alertCrossAbove150": False,
        }
    return {
        "portfolioId":        s.portfolio_id,
        "recipientEmail":     s.recipient_email,
        "emailEnabled":       s.email_enabled,
        "alertCrossBelow20":  s.alert_cross_below_20,
        "alertCrossBelow50":  s.alert_cross_below_50,
        "alertCrossBelow150": s.alert_cross_below_150,
        "alertCrossBelow200": s.alert_cross_below_200,
        "alertCrossAbove150": s.alert_cross_above_150,
    }


@router.put("/portfolio-settings/{portfolio_id}")
def save_portfolio_settings(portfolio_id: int, body: AlertSettingsBody,
                             db: Session = Depends(get_db)):
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    s = db.query(AlertSettings).filter_by(portfolio_id=portfolio_id).first()
    if not s:
        s = AlertSettings(portfolio_id=portfolio_id)
        db.add(s)
    s.recipient_email       = body.recipient_email
    s.email_enabled         = body.email_enabled
    s.alert_cross_below_20  = body.alert_cross_below_20
    s.alert_cross_below_50  = body.alert_cross_below_50
    s.alert_cross_below_150 = body.alert_cross_below_150
    s.alert_cross_below_200 = body.alert_cross_below_200
    s.alert_cross_above_150 = body.alert_cross_above_150
    db.commit()
    return {"ok": True}


# ─── Manual scan trigger ──────────────────────────────────────────────────────

@router.post("/scan/{portfolio_id}")
def trigger_scan(portfolio_id: int, body: dict = {}, db: Session = Depends(get_db)):
    """
    Manual scan: fetch fresh EMA, compute health, detect crosses, store results.
    Sends email if send_email=true in body AND email is configured + enabled.
    """
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    result = scan_portfolio(portfolio_id, db)
    if not result:
        raise HTTPException(status_code=500, detail="Scan failed")

    result["portfolioName"] = p.name
    email_sent = False
    if body.get("send_email"):
        email_sent = send_portfolio_alerts(portfolio_id, result, db)

    result["emailSent"] = email_sent
    return result


# ─── Scan history ─────────────────────────────────────────────────────────────

@router.get("/scan-history/{portfolio_id}")
def scan_history(portfolio_id: int, limit: int = 10, db: Session = Depends(get_db)):
    rows = (
        db.query(ScanResult)
        .filter(ScanResult.portfolio_id == portfolio_id)
        .order_by(ScanResult.scanned_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id":             r.id,
            "scannedAt":      r.scanned_at.isoformat(),
            "healthScore":    r.health_score,
            "healthCategory": r.health_category,
            "healthDetails":  json.loads(r.health_details) if r.health_details else None,
            "noData":         json.loads(r.no_data_json) if r.no_data_json else [],
        }
        for r in rows
    ]


@router.get("/last-scan/{portfolio_id}")
def last_scan(portfolio_id: int, db: Session = Depends(get_db)):
    row = (
        db.query(ScanResult)
        .filter(ScanResult.portfolio_id == portfolio_id)
        .order_by(ScanResult.scanned_at.desc())
        .first()
    )
    if not row:
        return {"hasScan": False}
    return {
        "hasScan":        True,
        "scannedAt":      row.scanned_at.isoformat(),
        "healthScore":    row.health_score,
        "healthCategory": row.health_category,
        "healthDetails":  json.loads(row.health_details) if row.health_details else None,
        "status":         json.loads(row.status_json),
        "noData":         json.loads(row.no_data_json) if row.no_data_json else [],
    }


# ─── Alerts history ───────────────────────────────────────────────────────────

@router.get("/alerts/{portfolio_id}")
def get_alerts(portfolio_id: int, limit: int = 30, db: Session = Depends(get_db)):
    rows = (
        db.query(SentAlert)
        .filter(SentAlert.portfolio_id == portfolio_id)
        .order_by(SentAlert.triggered_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id":           r.id,
            "symbol":       r.symbol,
            "alertType":    r.alert_type,
            "triggeredAt":  r.triggered_at.isoformat(),
            "currentPrice": r.current_price,
            "emaValue":     r.ema_value,
            "distancePct":  r.distance_pct,
            "emailSent":    r.email_sent,
        }
        for r in rows
    ]
