from sqlalchemy import create_engine, Column, Integer, String, Float, Date, DateTime, Boolean, Text, ForeignKey
from sqlalchemy.orm import DeclarativeBase, relationship, sessionmaker
from datetime import datetime, timezone
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "portfolios.db")
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class Portfolio(Base):
    __tablename__ = "portfolios"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String, nullable=False)
    type        = Column(String, nullable=False, default="custom")
    description = Column(String, nullable=True)
    color       = Column(String, nullable=False, default="#7c3aed")
    created_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                         onupdate=lambda: datetime.now(timezone.utc))

    holdings          = relationship("Holding",          back_populates="portfolio",
                                     cascade="all, delete-orphan", order_by="Holding.added_at")
    scan_results      = relationship("ScanResult",       back_populates="portfolio",
                                     cascade="all, delete-orphan")
    sent_alerts       = relationship("SentAlert",        back_populates="portfolio",
                                     cascade="all, delete-orphan")
    alert_settings    = relationship("AlertSettings",    back_populates="portfolio",
                                     cascade="all, delete-orphan", uselist=False)
    monitoring_rules  = relationship("MonitoringRule",   back_populates="portfolio",
                                     cascade="all, delete-orphan")


class Holding(Base):
    __tablename__ = "holdings"

    id             = Column(Integer, primary_key=True, index=True)
    portfolio_id   = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    symbol         = Column(String, nullable=False)
    quantity       = Column(Float, nullable=True)
    avg_buy_price  = Column(Float, nullable=True)
    buy_date       = Column(Date, nullable=True)
    notes          = Column(String, nullable=True)
    added_at       = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    portfolio = relationship("Portfolio", back_populates="holdings")


class ScanResult(Base):
    """One row per portfolio per scan run."""
    __tablename__ = "scan_results"

    id               = Column(Integer, primary_key=True, index=True)
    portfolio_id     = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    scanned_at       = Column(DateTime, nullable=False)
    status_json      = Column(Text, nullable=False)   # full EMA status dict as JSON
    health_score     = Column(Integer, nullable=True)
    health_category  = Column(String, nullable=True)
    health_details   = Column(Text, nullable=True)    # JSON breakdown
    no_data_json     = Column(Text, nullable=True)    # JSON list of symbols with no data
    crosses_json     = Column(Text, nullable=True)    # JSON list of cross events for this scan

    portfolio = relationship("Portfolio", back_populates="scan_results")


class SentAlert(Base):
    """One row per detected EMA cross event."""
    __tablename__ = "sent_alerts"

    id           = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    symbol       = Column(String, nullable=False)
    alert_type   = Column(String, nullable=False)  # cross_below_150, cross_above_150, etc.
    triggered_at = Column(DateTime, nullable=False)
    current_price= Column(Float, nullable=True)
    ema_value    = Column(Float, nullable=True)
    distance_pct = Column(Float, nullable=True)
    email_sent   = Column(Boolean, default=False)

    portfolio = relationship("Portfolio", back_populates="sent_alerts")


class AlertSettings(Base):
    """Per-portfolio alert preferences."""
    __tablename__ = "alert_settings"

    id                    = Column(Integer, primary_key=True, index=True)
    portfolio_id          = Column(Integer, ForeignKey("portfolios.id"), unique=True, nullable=False)
    recipient_email       = Column(String, nullable=True)
    email_enabled         = Column(Boolean, default=False)
    alert_cross_below_20  = Column(Boolean, default=False)
    alert_cross_below_50  = Column(Boolean, default=False)
    alert_cross_below_150 = Column(Boolean, default=True)
    alert_cross_below_200 = Column(Boolean, default=False)
    alert_cross_above_150 = Column(Boolean, default=False)

    portfolio = relationship("Portfolio", back_populates="alert_settings")


class EmailConfig(Base):
    """Global SMTP configuration (single row)."""
    __tablename__ = "email_config"

    id            = Column(Integer, primary_key=True, index=True)
    smtp_host     = Column(String, default="smtp.gmail.com")
    smtp_port     = Column(Integer, default=587)
    smtp_user     = Column(String, nullable=True)
    smtp_password = Column(String, nullable=True)   # Gmail App Password
    from_name     = Column(String, default="Portfolio Guardian")


class MonitoringRule(Base):
    """
    A user-defined rule that fires when its condition is met during a scan.

    rule_type = 'portfolio_threshold'
      → fires when operator(count_satisfying_condition, threshold_value) is True
      → e.g. "≥ 6 stocks below 150 EMA on 1h"

    rule_type = 'stock_ema'
      → fires when the named symbol satisfies condition vs EMA on timeframe
      → e.g. "RELIANCE is below 150 EMA on 1h"

    rule_type = 'stock_price_change'
      → fires when the named symbol's latest-bar % change vs the previous bar
        (on `timeframe`) meets `condition` (up | down | either) by `threshold_value`%
      → e.g. "RELIANCE dropped 10% or more on daily" — ema_period is unused (0)

    rule_type = 'portfolio_price_change'
      → same as stock_price_change but checked against EVERY holding; fires
        (with a breakdown, like portfolio_threshold) if ANY holding breaches
      → e.g. "any holding drops 10% or more on daily" — symbol/ema_period unused

    condition_b_json / logic_op (optional second condition, AND/OR with the
    primary condition — only meaningful when rule_type is stock_ema or
    stock_price_change, and always checked against the SAME symbol):
      {"metric": "ema", "timeframe": "daily", "ema_period": 150, "condition": "below"}
      {"metric": "price_change", "timeframe": "daily", "condition": "down", "threshold_value": 5}
    """
    __tablename__ = "monitoring_rules"

    id               = Column(Integer, primary_key=True, index=True)
    portfolio_id     = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    name             = Column(String, nullable=False)
    rule_type        = Column(String, nullable=False)   # portfolio_threshold | stock_ema | stock_price_change | portfolio_price_change
    timeframe        = Column(String, nullable=False)   # 1h | daily | weekly | …
    ema_period       = Column(Integer, nullable=False)  # 20 | 50 | 150 | 200 — unused (0) for *_price_change
    condition        = Column(String, nullable=False)   # above | below (ema types) | up | down | either (price_change types)

    # portfolio_threshold fields
    operator         = Column(String, nullable=True)    # gte | lte | eq
    threshold_type   = Column(String, nullable=True)    # count | percent
    threshold_value  = Column(Float, nullable=True)      # also used as the %Chg threshold for *_price_change

    # stock_ema / stock_price_change fields
    symbol           = Column(String, nullable=True)

    # optional second condition, combined with the primary one via logic_op
    condition_b_json = Column(Text, nullable=True)
    logic_op         = Column(String, nullable=True)    # AND | OR

    enabled          = Column(Boolean, default=True)
    created_at       = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_checked_at  = Column(DateTime, nullable=True)
    last_triggered_at= Column(DateTime, nullable=True)

    portfolio   = relationship("Portfolio", back_populates="monitoring_rules")
    rule_alerts = relationship("RuleAlert", back_populates="rule",
                               cascade="all, delete-orphan")


class RuleAlert(Base):
    """One row per rule violation event."""
    __tablename__ = "rule_alerts"

    id           = Column(Integer, primary_key=True, index=True)
    rule_id      = Column(Integer, ForeignKey("monitoring_rules.id"), nullable=False)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    triggered_at = Column(DateTime, nullable=False)
    details_json = Column(Text, nullable=True)   # JSON snapshot of what triggered
    email_sent   = Column(Boolean, default=False)

    rule = relationship("MonitoringRule", back_populates="rule_alerts")


def init_db():
    Base.metadata.create_all(bind=engine)
    # Add columns introduced after initial schema without dropping existing data.
    with engine.connect() as con:
        migrations = [
            ("scan_results",      "crosses_json",      "TEXT"),
            ("monitoring_rules",  "condition_b_json",   "TEXT"),
            ("monitoring_rules",  "logic_op",           "TEXT"),
        ]
        for table, col, ddl in migrations:
            try:
                con.execute(__import__("sqlalchemy").text(
                    f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"
                ))
                con.commit()
            except Exception:
                pass  # column already exists — ignore


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
