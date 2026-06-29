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
    Compare two scan results and return list of EMA cross events.
    Only fires on a FRESH cross (prev != curr for above/below).
    """
    crosses = []
    for symbol, curr in curr_status.items():
        prev = prev_status.get(symbol, {})
        if not prev or "ema" not in prev or "ema" not in curr:
            continue
        for period in ("20", "50", "150", "200"):
            prev_above = prev["ema"].get(period, {}).get("above")
            curr_above = curr["ema"].get(period, {}).get("above")
            if prev_above is None or curr_above is None:
                continue
            if prev_above == curr_above:
                continue   # no change
            direction = "above" if curr_above else "below"
            crosses.append({
                "symbol":       symbol,
                "period":       int(period),
                "alert_type":   f"cross_{direction}_{period}",
                "direction":    direction,
                "currentPrice": curr.get("currentPrice"),
                "ema_value":    curr["ema"][period].get("value"),
                "dist":         curr["ema"][period].get("dist"),
            })
    return crosses
