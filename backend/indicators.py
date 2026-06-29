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
        return {"label": label, "bull": bool(bull), "val": str(val)}

    conds = {}

    # 1–3: Price vs EMAs
    conds["price_gt_20ema"]  = _cond("Price > 20 EMA",  ltp > e20,  _pct(ltp, e20))
    conds["price_gt_50ema"]  = _cond("Price > 50 EMA",  ltp > e50,  _pct(ltp, e50))
    if e150 is not None:
        conds["price_gt_150ema"] = _cond("Price > 150 EMA", ltp > e150, _pct(ltp, e150))

    # 4: Short-term EMA alignment
    conds["ema20_gt_50"] = _cond("20 EMA > 50 EMA", e20 > e50, f"{e20:.1f} vs {e50:.1f}")

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

    # 10: Aroon — bullish when Aroon Up > 50; show Up value colored by threshold
    au, ad_ = aroon(high, low, 25)
    au_v = float(au.iloc[-1])  if not pd.isna(au.iloc[-1])  else 0.0
    ad_v = float(ad_.iloc[-1]) if not pd.isna(ad_.iloc[-1]) else 0.0
    conds["aroon_bull"] = _cond("Aroon Up(25)", au_v > 50, f"{au_v:.0f}")

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
