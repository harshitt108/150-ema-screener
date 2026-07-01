"""
Starter templates for the monitoring rule builder — so a user doesn't have
to design a rule from scratch. Each template is a partial RuleCreate body;
the frontend prefills the builder with it and lets the user tweak (usually
just the symbol) before saving. `symbol: "__FILL__"` marks a field the user
must fill in before the rule can be created.
"""

RULE_TEMPLATES = [
    {
        "key":         "sharp_drop_any_holding",
        "label":       "Sharp single-day drop (any holding)",
        "description": "Catches a crash like a single stock falling 15%+ in a day, "
                        "even if it doesn't cross any EMA — the gap this app didn't "
                        "cover before.",
        "body": {
            "rule_type":       "portfolio_price_change",
            "timeframe":       "daily",
            "condition":       "down",
            "threshold_value": 10,
        },
    },
    {
        "key":         "sharp_drop_one_stock",
        "label":       "Sharp single-day drop (one stock)",
        "description": "Same as above, but watching just one stock you care about.",
        "body": {
            "rule_type":       "stock_price_change",
            "timeframe":       "daily",
            "condition":       "down",
            "threshold_value": 10,
            "symbol":          "__FILL__",
        },
    },
    {
        "key":         "any_stock_below_150ema",
        "label":       "Early weakness — any stock below 150 EMA",
        "description": "Fires the moment even one holding slips below its 150-day "
                        "trend line — the earliest, broadest warning.",
        "body": {
            "rule_type":      "portfolio_threshold",
            "timeframe":      "daily",
            "ema_period":     150,
            "condition":      "below",
            "operator":       "gte",
            "threshold_type": "count",
            "threshold_value": 1,
        },
    },
    {
        "key":         "portfolio_broad_weakness",
        "label":       "Broad portfolio weakness",
        "description": "Fires when half or more of your holdings are below their "
                        "150 EMA at once — a portfolio-wide risk signal, not just "
                        "one stock having a bad day.",
        "body": {
            "rule_type":      "portfolio_threshold",
            "timeframe":      "daily",
            "ema_period":     150,
            "condition":      "below",
            "operator":       "gte",
            "threshold_type": "percent",
            "threshold_value": 50,
        },
    },
    {
        "key":         "breakdown_confirmed",
        "label":       "Confirmed breakdown (EMA cross AND price drop)",
        "description": "Higher-conviction alert: fires only when a stock is BOTH "
                        "below its 150 EMA AND has dropped 5%+ that day — filters "
                        "out noise from a single loose condition.",
        "body": {
            "rule_type":  "stock_ema",
            "timeframe":  "daily",
            "ema_period": 150,
            "condition":  "below",
            "symbol":     "__FILL__",
            "condition_b": {
                "metric":          "price_change",
                "timeframe":       "daily",
                "condition":       "down",
                "threshold_value": 5,
            },
            "logic_op": "AND",
        },
    },
    {
        "key":         "recovery_watch",
        "label":       "Recovery watch (cross above 150 EMA)",
        "description": "The flip side of a downtrend alert — fires when a stock "
                        "you're watching reclaims its 150 EMA, a common "
                        "trend-reversal signal.",
        "body": {
            "rule_type":  "stock_ema",
            "timeframe":  "daily",
            "ema_period": 150,
            "condition":  "above",
            "symbol":     "__FILL__",
        },
    },
]
