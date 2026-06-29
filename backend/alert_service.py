"""
Email alert service — builds HTML emails and sends them via SMTP.
"""
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from database import AlertSettings, EmailConfig, SentAlert, Portfolio

logger = logging.getLogger(__name__)

# ─── Helpers ─────────────────────────────────────────────────────────────────

CATEGORY_COLOR = {
    "Excellent": "#10b981",
    "Healthy":   "#22c55e",
    "Watch":     "#eab308",
    "Weakening": "#f97316",
    "Critical":  "#ef4444",
}

DIRECTION_EMOJI = {
    "below": "⚠️",
    "above": "✅",
}


def _cross_sentence(cross: dict) -> str:
    sym    = cross["symbol"]
    period = cross["period"]
    price  = cross.get("currentPrice", "—")
    ema    = cross.get("ema_value", "—")
    dist   = cross.get("dist")
    dist_s = f"{dist:+.1f}%" if dist is not None else ""

    if cross["direction"] == "below":
        return (
            f"<b>{sym}</b> closed <span style='color:#ef4444'>below the {period} EMA</span> "
            f"at ₹{price} (EMA: ₹{ema}&nbsp;{dist_s})"
        )
    return (
        f"<b>{sym}</b> crossed <span style='color:#10b981'>above the {period} EMA</span> "
        f"at ₹{price} (EMA: ₹{ema}&nbsp;{dist_s})"
    )


def build_html_email(portfolio_name: str, crosses: list[dict], health: dict) -> str:
    score    = health.get("score", "—")
    category = health.get("category", "—")
    color    = CATEGORY_COLOR.get(category, "#94a3b8")
    above150 = health.get("above150", "—")
    total    = health.get("total", "—")

    below_rows = [c for c in crosses if c["direction"] == "below"]
    above_rows = [c for c in crosses if c["direction"] == "above"]

    def section(title: str, rows: list, accent: str) -> str:
        if not rows:
            return ""
        items = "".join(
            f"<tr><td style='padding:10px 0;border-bottom:1px solid #1e1e30'>"
            f"{DIRECTION_EMOJI[r['direction']]} {_cross_sentence(r)}</td></tr>"
            for r in rows
        )
        return f"""
        <h3 style='color:{accent};margin:24px 0 8px'>{title}</h3>
        <table width='100%' cellpadding='0' cellspacing='0'>{items}</table>
        """

    body = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset='utf-8'></head>
    <body style='background:#0a0a12;color:#e2e8f0;font-family:system-ui,sans-serif;
                 max-width:600px;margin:0 auto;padding:32px 24px'>

      <!-- Header -->
      <div style='background:#0d0d18;border:1px solid #1e1e30;border-radius:16px;
                  padding:24px;margin-bottom:24px'>
        <div style='display:flex;align-items:center;gap:12px;margin-bottom:4px'>
          <span style='font-size:20px'>📊</span>
          <span style='color:#7c3aed;font-weight:700;font-size:14px;
                       letter-spacing:0.05em'>PORTFOLIO GUARDIAN</span>
        </div>
        <h1 style='margin:0;font-size:22px;color:#fff'>{portfolio_name}</h1>
        <p style='margin:6px 0 0;color:#64748b;font-size:13px'>
          Alert report · {datetime.now().strftime("%d %b %Y, %I:%M %p")}
        </p>
      </div>

      <!-- Health Score -->
      <div style='background:#0f0f1a;border:1px solid #1e1e30;border-radius:12px;
                  padding:20px;margin-bottom:24px;display:flex;
                  align-items:center;gap:20px'>
        <div style='text-align:center;min-width:80px'>
          <div style='font-size:40px;font-weight:800;color:{color};line-height:1'>
            {score}
          </div>
          <div style='font-size:11px;color:{color};margin-top:4px;font-weight:600;
                      text-transform:uppercase;letter-spacing:0.08em'>{category}</div>
        </div>
        <div style='border-left:1px solid #1e1e30;padding-left:20px'>
          <p style='margin:0;color:#94a3b8;font-size:13px'>Portfolio Health Score</p>
          <p style='margin:6px 0 0;color:#e2e8f0;font-size:13px'>
            {above150} of {total} holdings above the 150 EMA
          </p>
        </div>
      </div>

      <!-- Alerts -->
      {section("⚠️ Crossed Below EMA", below_rows, "#ef4444")}
      {section("✅ Crossed Above EMA", above_rows, "#10b981")}

      <!-- Footer -->
      <div style='margin-top:32px;padding-top:20px;border-top:1px solid #1e1e30;
                  color:#475569;font-size:12px;text-align:center'>
        Sent by Portfolio Guardian · NSE EMA Toolkit<br>
        <span style='color:#334155'>This is an automated technical alert, not investment advice.</span>
      </div>

    </body>
    </html>
    """
    return body


# ─── Send ─────────────────────────────────────────────────────────────────────

def send_email(cfg: EmailConfig, to_email: str, subject: str, html: str) -> bool:
    """Send an HTML email. Returns True on success."""
    if not cfg.smtp_user or not cfg.smtp_password:
        logger.warning("Email config incomplete — skipping send")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"{cfg.from_name} <{cfg.smtp_user}>"
        msg["To"]      = to_email
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.login(cfg.smtp_user, cfg.smtp_password)
            server.sendmail(cfg.smtp_user, to_email, msg.as_string())
        logger.info(f"Email sent to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Email send failed: {e}")
        return False


# ─── Main entry point ─────────────────────────────────────────────────────────

def send_portfolio_alerts(portfolio_id: int, scan_result: dict, db: Session) -> bool:
    """
    Read alert settings for the portfolio, filter crosses by user preferences,
    send email if there's anything to report.
    Returns True if email was sent.
    """
    settings: AlertSettings | None = (
        db.query(AlertSettings)
        .filter(AlertSettings.portfolio_id == portfolio_id)
        .first()
    )
    if not settings or not settings.email_enabled or not settings.recipient_email:
        return False

    cfg: EmailConfig | None = db.query(EmailConfig).first()
    if not cfg or not cfg.smtp_user:
        logger.warning(f"No SMTP config — skipping email for portfolio {portfolio_id}")
        return False

    crosses: list[dict] = scan_result.get("crosses", [])
    health: dict        = scan_result.get("health", {})
    portfolio_name: str = scan_result.get("portfolioName", f"Portfolio {portfolio_id}")

    # Filter crosses by user preferences
    enabled_types: set[str] = set()
    if settings.alert_cross_below_20:  enabled_types.add("cross_below_20")
    if settings.alert_cross_below_50:  enabled_types.add("cross_below_50")
    if settings.alert_cross_below_150: enabled_types.add("cross_below_150")
    if settings.alert_cross_below_200: enabled_types.add("cross_below_200")
    if settings.alert_cross_above_150: enabled_types.add("cross_above_150")

    filtered = [c for c in crosses if c["alert_type"] in enabled_types]
    if not filtered:
        return False

    subject = f"⚠️ Portfolio Alert: {portfolio_name} — {len(filtered)} EMA event{'s' if len(filtered) > 1 else ''}"
    html    = build_html_email(portfolio_name, filtered, health)
    sent    = send_email(cfg, settings.recipient_email, subject, html)

    if sent:
        # Mark alerts as emailed
        db.query(SentAlert).filter(
            SentAlert.portfolio_id == portfolio_id,
            SentAlert.email_sent   == False,
        ).update({"email_sent": True})
        db.commit()

    return sent
