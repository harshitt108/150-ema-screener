"""
Technical indicators for the Buy/Sell/Hold signal engine.
13 conditions (10 price/technical + 3 ratio when available).
BUY ≥ 70% bullish, SELL < 40%, else HOLD.
"""
import numpy as np
import pandas as pd
from typing import Optional


# ─── Indicator math ─────────────────────────────────────────────────────────

def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(com=period - 1, adjust=False).mean()
    avg_loss = loss.ewm(com=period - 1, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def macd(close: pd.Series, fast: int = 12, slow: int = 26, sig: int = 9):
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=sig, adjust=False).mean()
    return macd_line, signal_line


def momentum(close: pd.Series, period: int = 21) -> pd.Series:
    return close - close.shift(period)


def obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    direction = np.sign(close.diff()).fillna(0)
    return (volume * direction).cumsum()


def ad_line(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series) -> pd.Series:
    hl = (high - low).replace(0, np.nan)
    clv = ((close - low) - (high - close)) / hl
    return (clv.fillna(0) * volume).cumsum()


def aroon(high: pd.Series, low: pd.Series, period: int = 25):
    win = period + 1
    aroon_up = high.rolling(win).apply(
        lambda x: (np.argmax(x) / period) * 100, raw=True
    )
    aroon_down = low.rolling(win).apply(
        lambda x: (np.argmin(x) / period) * 100, raw=True
    )
    return aroon_up, aroon_down


# ─── Signal engine ───────────────────────────────────────────────────────────

def compute_signals(stock_df: pd.DataFrame, ratio: Optional[pd.Series] = None) -> dict:
    """
    Compute up to 13 trading conditions:
      10 price/technical (always present)
       3 ratio conditions (added when ratio series is provided)

    Returns:
        signal      : "BUY" | "HOLD" | "SELL"
        bullCount   : int
        total       : int
        pct         : float
        conditions  : dict of {key: {label, bull, val}}
    """
    from scanner import calculate_ema  # defer to avoid circular import

    close  = stock_df["Close"]
    high   = stock_df["High"]
    low    = stock_df["Low"]
    volume = stock_df["Volume"]
    n      = len(close)

    # ── Price EMAs ──────────────────────────────────────────────────────────
    e20  = float(calculate_ema(close, 20).iloc[-1])
    e50  = float(calculate_ema(close, 50).iloc[-1])
    e150 = float(calculate_ema(close, 150).iloc[-1]) if n >= 150 else None
    ltp  = float(close.iloc[-1])

    def _pct(v, ref):
        return f"{(v - ref) / ref * 100:+.2f}%"

    def _cond(label, bull, val):
        bull = bool(bull)
        # Every label here is phrased as the bullish condition ("X > Y") — when
        # it's false, the actual relationship is the reverse, so flip the sign
        # rather than showing a false ">" next to a red/bearish chip.
        if not bull and " > " in label:
            label = label.replace(" > ", " < ")
        return {"label": label, "bull": bull, "val": str(val)}

    conds = {}

    # 1–3: Price vs EMAs
    conds["price_gt_20ema"]  = _cond("Price > 20 EMA",  ltp > e20,  _pct(ltp, e20))
    conds["price_gt_50ema"]  = _cond("Price > 50 EMA",  ltp > e50,  _pct(ltp, e50))
    if e150 is not None:
        conds["price_gt_150ema"] = _cond("Price > 150 EMA", ltp > e150, _pct(ltp, e150))

    # 4: Short-term EMA alignment
    ema20_bull = e20 > e50
    conds["ema20_gt_50"] = _cond(
        "20 EMA > 50 EMA", ema20_bull,
        f"{'Bullish' if ema20_bull else 'Bearish'} ({e20:.1f} vs {e50:.1f})"
    )

    # 5: RSI
    rsi_val = float(rsi(close, 14).iloc[-1])
    conds["rsi_gt_50"] = _cond("RSI(14) > 50", rsi_val > 50, f"{rsi_val:.1f}")

    # 6: MACD — require a 0.5% gap to avoid flipping on borderline data-source noise
    macd_l, sig_l = macd(close)
    mv, sv = float(macd_l.iloc[-1]), float(sig_l.iloc[-1])
    scale    = max(abs(mv), abs(sv), 0.001)
    gap_pct  = (mv - sv) / scale * 100   # positive = MACD above signal
    macd_bull = gap_pct > 0.5            # must be clearly above, not just noise
    macd_bear = gap_pct < -0.5
    # show the raw MACD vs Signal values so trader can judge
    mv_fmt = f"{mv:+.2f}" if abs(mv) < 1000 else f"{mv:+.0f}"
    sv_fmt = f"{sv:+.2f}" if abs(sv) < 1000 else f"{sv:+.0f}"
    conds["macd_gt_signal"] = _cond(
        "MACD > Signal",
        macd_bull,
        ("Bullish" if macd_bull else ("Bearish" if macd_bear else f"Neutral {mv_fmt}/{sv_fmt}"))
    )

    # 7: ROC(21) > 0  (Rate of Change = % change over 21 periods)
    if n > 21:
        prev = float(close.iloc[-22])
        roc_val = (float(close.iloc[-1]) - prev) / prev * 100 if prev != 0 else 0.0
        conds["roc_pos"] = _cond("ROC(21) > 0", roc_val > 0, f"{roc_val:+.2f}%")

    # 8: OBV vs its 50 EMA
    obv_s    = obv(close, volume)
    obv_e50  = calculate_ema(obv_s, 50)
    obv_bull = float(obv_s.iloc[-1]) > float(obv_e50.iloc[-1])
    conds["obv_gt_ema"] = _cond("OBV > 50 EMA", obv_bull, "Yes" if obv_bull else "No")

    # 9: A/D Line vs its 21 EMA
    ad_s     = ad_line(high, low, close, volume)
    ad_e21   = calculate_ema(ad_s, 21)
    ad_bull  = float(ad_s.iloc[-1]) > float(ad_e21.iloc[-1])
    conds["ad_gt_ema"] = _cond("A/D Line > 21 EMA", ad_bull, "Yes" if ad_bull else "No")

    # 10: Aroon Oscillator (Aroon Up − Aroon Down) — bullish when above 0
    au, ad_ = aroon(high, low, 25)
    au_v = float(au.iloc[-1])  if not pd.isna(au.iloc[-1])  else 0.0
    ad_v = float(ad_.iloc[-1]) if not pd.isna(ad_.iloc[-1]) else 0.0
    aroon_osc = au_v - ad_v
    conds["aroon_bull"] = _cond("Aroon Osc(25) > 0", aroon_osc > 0, f"{aroon_osc:+.0f}")

    # 11–13: Ratio conditions (only when a ratio series is supplied)
    if ratio is not None and len(ratio) >= 20:
        r_cur = float(ratio.iloc[-1])
        r_e20 = float(calculate_ema(ratio, 20).iloc[-1])
        conds["ratio_gt_20ema"] = _cond("Ratio > 20 EMA",  r_cur > r_e20,  _pct(r_cur, r_e20))

        if len(ratio) >= 50:
            r_e50 = float(calculate_ema(ratio, 50).iloc[-1])
            conds["ratio_gt_50ema"] = _cond("Ratio > 50 EMA", r_cur > r_e50, _pct(r_cur, r_e50))

        if len(ratio) >= 150:
            r_e150 = float(calculate_ema(ratio, 150).iloc[-1])
            conds["ratio_gt_150ema"] = _cond("Ratio > 150 EMA", r_cur > r_e150, _pct(r_cur, r_e150))

    # ── Score ───────────────────────────────────────────────────────────────
    total      = len(conds)
    bull_count = sum(1 for c in conds.values() if c["bull"])
    pct        = bull_count / total * 100 if total else 0

    signal = "BUY" if pct >= 70 else ("SELL" if pct < 40 else "HOLD")

    return {
        "signal":     signal,
        "bullCount":  bull_count,
        "total":      total,
        "pct":        round(pct, 1),
        "conditions": conds,
    }


# ─── Multi-timeframe matrix ──────────────────────────────────────────────────

def compute_mtf_snapshot(df: pd.DataFrame, ratio: Optional[pd.Series] = None) -> dict:
    """Snapshot of 8 indicators at the latest bar of `df` — one column of the
    multi-timeframe matrix. Each row is None when there isn't enough history
    for that indicator to be meaningful (e.g. 150 EMA on a short intraday range)."""
    from scanner import calculate_ema

    close, high, low = df["Close"], df["High"], df["Low"]

    def last(s):
        if s is None or len(s) == 0:
            return None
        v = s.iloc[-1]
        return None if pd.isna(v) else float(v)

    rows = {}
    bull_count = 0
    total = 0

    def count(bull):
        nonlocal bull_count, total
        total += 1
        if bull:
            bull_count += 1

    ltp = last(close)

    rsi_v = last(rsi(close, 14))
    if rsi_v is not None:
        b = rsi_v > 50
        rows["rsi"] = {"value": round(rsi_v, 1), "bull": b}
        count(b)
    else:
        rows["rsi"] = None

    macd_l, sig_l = macd(close)
    mv, sv = last(macd_l), last(sig_l)
    if mv is not None and sv is not None:
        b = mv > sv
        rows["macd"] = {"status": "Bull" if b else "Bear", "bull": b}
        count(b)
    else:
        rows["macd"] = None

    e20  = last(calculate_ema(close, 20))
    e50  = last(calculate_ema(close, 50))
    e150 = last(calculate_ema(close, 150))

    if e20 is not None and ltp is not None:
        b = ltp > e20
        rows["ema20"] = {"value": round(e20, 2), "bull": b}
        count(b)
    else:
        rows["ema20"] = None

    if e50 is not None and ltp is not None:
        b = ltp > e50
        rows["ema50"] = {"value": round(e50, 2), "bull": b}
        count(b)
    else:
        rows["ema50"] = None

    if e150 is not None and ltp is not None:
        b = ltp > e150
        rows["ema150"] = {"value": round(e150, 2), "bull": b}
        count(b)
    else:
        rows["ema150"] = None

    if e20 is not None and e50 is not None:
        b = e20 > e50
        rows["emaCross"] = {"above": b, "bull": b, "ema20": round(e20, 2), "ema50": round(e50, 2)}
        count(b)
    else:
        rows["emaCross"] = None

    rows["ratioEma20"] = None
    if ratio is not None and len(ratio) >= 20:
        r_cur = last(ratio)
        r_e20 = last(calculate_ema(ratio, 20))
        if r_cur is not None and r_e20 is not None:
            b = r_cur > r_e20
            rows["ratioEma20"] = {"value": round(r_cur, 4), "ema": round(r_e20, 4), "bull": b}
            count(b)

    au, adn = aroon(high, low, 25)
    au_v, adn_v = last(au), last(adn)
    if au_v is not None and adn_v is not None:
        osc = au_v - adn_v
        b = osc > 0
        rows["aroon"] = {"value": round(osc, 0), "bull": b}
        count(b)
    else:
        rows["aroon"] = None

    rows["bullCount"] = bull_count
    rows["total"] = total
    return rows


# ─── Signal history (derived crossover events) ──────────────────────────────

def _crossover_events(series: pd.Series, ref: pd.Series, start_i: int, label_up: str, label_down: str) -> list:
    ev = []
    n = len(series)
    for i in range(start_i, n):
        if pd.isna(ref.iloc[i]) or pd.isna(ref.iloc[i - 1]):
            continue
        prev_above = float(series.iloc[i - 1]) > float(ref.iloc[i - 1])
        cur_above  = float(series.iloc[i])     > float(ref.iloc[i])
        if cur_above and not prev_above:
            ev.append({"date": series.index[i], "type": "bullish", "label": label_up})
        elif not cur_above and prev_above:
            ev.append({"date": series.index[i], "type": "bearish", "label": label_down})
    return ev


def compute_signal_history(df: pd.DataFrame, ratio: Optional[pd.Series] = None,
                            lookback_days: int = 120, max_events: int = 20) -> list:
    """Dated crossover / regime-change events over the trailing window,
    derived from already-fetched OHLC (+ ratio) history — no persistence needed."""
    from scanner import calculate_ema

    close, high, low, volume = df["Close"], df["High"], df["Low"], df["Volume"]
    n = len(close)
    if n < 30:
        return []

    start_i = max(1, n - lookback_days)
    events = []

    e20, e50, e150 = calculate_ema(close, 20), calculate_ema(close, 50), calculate_ema(close, 150)
    events += _crossover_events(close, e20,  start_i, "Price crossed above 20 EMA",  "Price crossed below 20 EMA")
    events += _crossover_events(close, e50,  start_i, "Price crossed above 50 EMA",  "Price crossed below 50 EMA")
    events += _crossover_events(close, e150, start_i, "Price crossed above 150 EMA", "Price crossed below 150 EMA")

    macd_l, sig_l = macd(close)
    events += _crossover_events(macd_l, sig_l, start_i, "MACD turned bullish", "MACD turned bearish")

    rsi_s = rsi(close, 14)
    fifty = pd.Series(50.0, index=rsi_s.index)
    events += _crossover_events(rsi_s, fifty, start_i, "RSI entered bullish zone (>50)", "RSI entered bearish zone (<50)")

    vol_avg50 = volume.rolling(50).mean()
    for i in range(start_i, n):
        avg = vol_avg50.iloc[i]
        if pd.isna(avg) or avg <= 0:
            continue
        if float(volume.iloc[i]) > 1.5 * float(avg):
            direction = "bullish" if float(close.iloc[i]) >= float(close.iloc[i - 1]) else "bearish"
            events.append({"date": close.index[i], "type": direction, "label": "Volume breakout confirmed"})

    if ratio is not None and len(ratio) >= 20:
        r_e20 = calculate_ema(ratio, 20)
        r_start = max(1, len(ratio) - lookback_days)
        events += _crossover_events(ratio, r_e20, r_start, "Ratio crossed above 20 EMA", "Ratio crossed below 20 EMA")

    events.sort(key=lambda e: e["date"])
    out = events[-max_events:]
    return [{"date": e["date"].strftime("%Y-%m-%d"), "type": e["type"], "label": e["label"]} for e in out]


# ─── Rating history (walk-forward score, no lookahead) ──────────────────────

def compute_rating_history(df: pd.DataFrame, ratio: Optional[pd.Series] = None, days: int = 20) -> list:
    """Score for each of the last `days` bars using only indicator values already
    settled at that bar (EMA/RSI/MACD/etc. are causal by construction) — so this
    is a true walk-forward score, not a recomputation with future data removed."""
    from scanner import calculate_ema

    close, high, low, volume = df["Close"], df["High"], df["Low"], df["Volume"]
    n = len(close)
    if n < 30:
        return []

    e20, e50, e150 = calculate_ema(close, 20), calculate_ema(close, 50), calculate_ema(close, 150)
    macd_l, sig_l = macd(close)
    rsi_s = rsi(close, 14)
    roc_s = momentum(close, 21)
    obv_s = obv(close, volume)
    obv_e50 = calculate_ema(obv_s, 50)
    ad_s = ad_line(high, low, close, volume)
    ad_e21 = calculate_ema(ad_s, 21)
    au, adn = aroon(high, low, 25)
    aroon_osc = au - adn

    ratio_emas = []
    if ratio is not None and len(ratio) >= 20:
        ratio_emas.append(calculate_ema(ratio, 20))
        if len(ratio) >= 50:
            ratio_emas.append(calculate_ema(ratio, 50))
        if len(ratio) >= 150:
            ratio_emas.append(calculate_ema(ratio, 150))

    def rating_for(pct):
        if pct >= 80: return "Strong Buy"
        if pct >= 70: return "Buy"
        if pct >= 40: return "Hold"
        if pct >= 20: return "Sell"
        return "Strong Sell"

    out = []
    for idx in close.index[-days:]:
        conds = []
        if not pd.isna(e20.loc[idx]):
            conds.append(float(close.loc[idx]) > float(e20.loc[idx]))
        if not pd.isna(e50.loc[idx]):
            conds.append(float(close.loc[idx]) > float(e50.loc[idx]))
        if not pd.isna(e150.loc[idx]):
            conds.append(float(close.loc[idx]) > float(e150.loc[idx]))
        if not pd.isna(e20.loc[idx]) and not pd.isna(e50.loc[idx]):
            conds.append(float(e20.loc[idx]) > float(e50.loc[idx]))
        if not pd.isna(rsi_s.loc[idx]):
            conds.append(float(rsi_s.loc[idx]) > 50)
        if not pd.isna(macd_l.loc[idx]) and not pd.isna(sig_l.loc[idx]):
            conds.append(float(macd_l.loc[idx]) > float(sig_l.loc[idx]))
        if not pd.isna(roc_s.loc[idx]):
            conds.append(float(roc_s.loc[idx]) > 0)
        if not pd.isna(obv_e50.loc[idx]):
            conds.append(float(obv_s.loc[idx]) > float(obv_e50.loc[idx]))
        if not pd.isna(ad_e21.loc[idx]):
            conds.append(float(ad_s.loc[idx]) > float(ad_e21.loc[idx]))
        if not pd.isna(aroon_osc.loc[idx]):
            conds.append(float(aroon_osc.loc[idx]) > 0)
        for r_e in ratio_emas:
            if idx in r_e.index and idx in ratio.index and not pd.isna(r_e.loc[idx]):
                conds.append(float(ratio.loc[idx]) > float(r_e.loc[idx]))

        total = len(conds)
        bull = sum(1 for c in conds if c)
        pct = round(bull / total * 100, 1) if total else 0.0
        out.append({"date": idx.strftime("%Y-%m-%d"), "score": pct, "rating": rating_for(pct)})

    for i in range(len(out)):
        out[i]["change"] = None if i == 0 else round(out[i]["score"] - out[i - 1]["score"], 1)

    return out
