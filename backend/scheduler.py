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


def _data_health_job():
    """Daily data-quality sweep (daily timeframe across the whole universe).
    Catches staleness / malformed bars automatically instead of a trader
    noticing a wrong price — see data_health.py for what's checked."""
    from data_health import run_health_sweep

    logger.info("[scheduler] Starting daily data-health sweep…")
    try:
        report = run_health_sweep(timeframes=["daily"])
        if report["healthy"]:
            logger.info(
                "[scheduler] Data health OK — %s/%s clean (session %s)",
                report["clean"], report["checked"], report["reference_session"],
            )
        else:
            logger.error(
                "[scheduler] DATA HEALTH ISSUES — %s flagged of %s: %s",
                report["flagged"], report["checked"],
                {k: v["count"] for k, v in report["categories"].items()},
            )
    except Exception as e:
        logger.error(f"[scheduler] Data-health sweep failed: {e}", exc_info=True)


def start_scheduler():
    # Data-health sweep at 3:45 PM IST — verifies the data BEFORE the 4:00 PM
    # portfolio scan computes alerts from it.
    scheduler.add_job(
        _data_health_job,
        CronTrigger(hour=15, minute=45, timezone="Asia/Kolkata"),
        id="data_health_sweep",
        replace_existing=True,
    )
    # Daily scan at 4:00 PM IST (30 min after NSE close)
    scheduler.add_job(
        _daily_scan_job,
        CronTrigger(hour=16, minute=0, timezone="Asia/Kolkata"),
        id="daily_scan",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("[scheduler] Started. Data-health sweep 3:45 PM, daily scan 4:00 PM IST.")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[scheduler] Stopped.")
