# EMA weights (sum to 100). The UI displays these exact weights so the score
# and the on-screen breakdown always agree.
HEALTH_WEIGHTS = {"150": 40, "50": 25, "200": 20, "20": 15}


def calculate_health_score(status: dict) -> dict:
    """
    Calculate portfolio health score (0-100) from EMA status dict.

    status: { symbol: { currentPrice, ema: { "20": {above, dist, value}, ... } } }

    Each EMA contributes its weight, scored as "% of holdings that HAVE that EMA
    which are above it". A holding that lacks an EMA (e.g. a recent listing with
    <200 bars) is excluded from that EMA's denominator instead of silently
    counting as "below" — and if an entire EMA is unavailable across the
    portfolio, its weight is dropped and the remaining weights are renormalised
    to 100. This keeps the score honest and identical to the displayed weights.
    """
    symbols = [s for s, v in status.items() if "ema" in v]
    n = len(symbols)
    base = {
        "score": 0, "category": "Unknown",
        "above150": 0, "above50": 0, "above200": 0, "above20": 0,
        "counted150": 0, "counted50": 0, "counted200": 0, "counted20": 0,
        "total": n, "weights": HEALTH_WEIGHTS,
    }
    if n == 0:
        return base

    def count_above(period: str) -> int:
        return sum(1 for s in symbols if status[s]["ema"].get(period, {}).get("above"))

    def count_with(period: str) -> int:
        return sum(1 for s in symbols if status[s]["ema"].get(period) is not None)

    above   = {p: count_above(p) for p in HEALTH_WEIGHTS}
    counted = {p: count_with(p)  for p in HEALTH_WEIGHTS}

    acc, total_w = 0.0, 0.0
    for period, w in HEALTH_WEIGHTS.items():
        if counted[period] > 0:
            acc += (above[period] / counted[period]) * w
            total_w += w
    score = round(acc / total_w * 100) if total_w else 0
    score = max(0, min(100, score))

    if score >= 95:   category = "Excellent"
    elif score >= 80: category = "Healthy"
    elif score >= 60: category = "Watch"
    elif score >= 40: category = "Weakening"
    else:             category = "Critical"

    return {
        "score":      score,
        "category":   category,
        "above150":   above["150"], "above50": above["50"], "above200": above["200"], "above20": above["20"],
        "counted150": counted["150"], "counted50": counted["50"], "counted200": counted["200"], "counted20": counted["20"],
        "total":      n,
        "weights":    HEALTH_WEIGHTS,
    }


def detect_crosses(prev_status: dict, curr_status: dict) -> list[dict]:
    """
    Compare two scan results and return EMA cross events (Daily timeframe).

    Two categories — both are system-level, independent of user rules:
      1. Price vs EMA crosses  (20 / 50 / 150 / 200)
      2. EMA vs EMA crosses    (Golden Cross: 20 EMA > 50 EMA
                                Death  Cross: 20 EMA < 50 EMA)

    Only fires on a FRESH transition (state changed since last scan).
    """
    crosses = []
    for symbol, curr in curr_status.items():
        prev = prev_status.get(symbol, {})
        if not prev or "ema" not in prev or "ema" not in curr:
            continue

        # ── 1. Price vs EMA crosses (20 / 50 / 150 / 200) ──────────────────
        for period in ("20", "50", "150", "200"):
            prev_above = prev["ema"].get(period, {}).get("above")
            curr_above = curr["ema"].get(period, {}).get("above")
            if prev_above is None or curr_above is None:
                continue
            if prev_above == curr_above:
                continue  # no change — not a fresh cross
            direction = "above" if curr_above else "below"
            crosses.append({
                "symbol":       symbol,
                "cross_type":   "price_ema",
                "period":       int(period),
                "alert_type":   f"cross_{direction}_{period}",
                "direction":    direction,
                "label":        f"crossed {'above' if curr_above else 'below'} the {period} EMA",
                "currentPrice": curr.get("currentPrice"),
                "ema_value":    curr["ema"][period].get("value"),
                "dist":         curr["ema"][period].get("dist"),
            })

        # ── 2. Golden Cross / Death Cross  (20 EMA vs 50 EMA) ───────────────
        prev_e20 = prev["ema"].get("20", {}).get("value")
        prev_e50 = prev["ema"].get("50", {}).get("value")
        curr_e20 = curr["ema"].get("20", {}).get("value")
        curr_e50 = curr["ema"].get("50", {}).get("value")

        if all(v is not None for v in [prev_e20, prev_e50, curr_e20, curr_e50]):
            prev_golden = prev_e20 > prev_e50
            curr_golden = curr_e20 > curr_e50
            if prev_golden != curr_golden:  # fresh EMA-vs-EMA cross
                is_golden = curr_golden
                # Require a minimum 0.5% separation to avoid noise — when the
                # two EMAs are within 0.5% of each other the "cross" is a
                # wobble, not a real signal, and would look identical on a chart.
                ref = curr_e50 if curr_e50 else 1
                margin_pct = abs(curr_e20 - curr_e50) / ref * 100
                if margin_pct < 0.5:
                    continue  # too close — skip to avoid false alerts
                crosses.append({
                    "symbol":       symbol,
                    "cross_type":   "ema_ema",
                    "period":       None,
                    "alert_type":   "golden_cross" if is_golden else "death_cross",
                    "direction":    "above" if is_golden else "below",
                    "label":        ("Golden Cross — 20 EMA crossed above 50 EMA"
                                     if is_golden else
                                     "Death Cross — 20 EMA crossed below 50 EMA"),
                    "currentPrice": curr.get("currentPrice"),
                    "ema20_value":  curr_e20,
                    "ema50_value":  curr_e50,
                    "dist":         round(margin_pct, 2),
                })

    return crosses
