"""
Background scheduler — runs a daily portfolio scan after NSE market close.
"""
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from database import SessionLocal
from scan_engine import scan_all_portfolios
from alert_service import send_portfolio_alerts

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone="Asia/Kolkata")


def _daily_scan_job():
    """Runs inside the APScheduler background thread."""
    logger.info("[scheduler] Starting daily portfolio scan…")
    db = SessionLocal()
    try:
        results = scan_all_portfolios(db)
        for result in results:
            pid  = result["portfolioId"]
            name = db.query(__import__("database").Portfolio).get(pid)
            result["portfolioName"] = name.name if name else f"Portfolio {pid}"
            sent = send_portfolio_alerts(pid, result, db)
            logger.info(
                f"[scheduler] portfolio={pid} score={result['health']['score']} "
                f"crosses={len(result['crosses'])} email_sent={sent}"
            )
    except Exception as e:
        logger.error(f"[scheduler] Daily scan failed: {e}", exc_info=True)
    finally:
        db.close()
    logger.info("[scheduler] Daily scan complete.")


def start_scheduler():
    # Daily scan at 4:00 PM IST (30 min after NSE close)
    scheduler.add_job(
        _daily_scan_job,
        CronTrigger(hour=16, minute=0, timezone="Asia/Kolkata"),
        id="daily_scan",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("[scheduler] Started. Daily scan scheduled at 4:00 PM IST.")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[scheduler] Stopped.")
