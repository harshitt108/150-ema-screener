"""
Constituent lists for the Index Scanner — "show me the stocks inside this index".

Broad-market and the 8 sectoral indices reuse the already-verified lists in
indices.py (same symbols the scanner runs on). The remaining sectoral indices
(Media, PSU Bank, Fin Services, Private Bank) and the thematic indices are
curated here from recent NSE composition. NSE revises membership periodically,
so thematic lists are representative rather than tick-for-tick official.

Company names come from symbol_names.SYMBOL_NAMES where known (falls back to the
ticker). Every symbol resolves to a chartable {symbol}.NS ticker on click.
"""
from indices import INDICES
from symbol_names import SYMBOL_NAMES

# Index Scanner display name -> indices.py key (those lists are canonical/verified).
_INDICES_PY_ALIAS = {
    "NIFTY 50":         "NIFTY 50",
    "NIFTY Next 50":    "NIFTY NEXT 50",
    "NIFTY 100":        "NIFTY 100",
    "NIFTY 200":        "NIFTY 200",
    "NIFTY 500":        "NIFTY 500",
    "NIFTY Midcap 150": "NIFTY MIDCAP 150",
    "NIFTY Bank":       "NIFTY BANK",
    "NIFTY IT":         "NIFTY IT",
    "NIFTY Auto":       "NIFTY AUTO",
    "NIFTY Pharma":     "NIFTY PHARMA",
    "NIFTY FMCG":       "NIFTY FMCG",
    "NIFTY Metal":      "NIFTY METAL",
    "NIFTY Realty":     "NIFTY REALTY",
    "NIFTY Energy":     "NIFTY ENERGY",
}

# Curated constituent lists for indices not present in indices.py.
_EXTRA = {
    # ── Sectoral ──────────────────────────────────────────────────────────────
    "NIFTY Media": [
        "ZEEL", "SUNTV", "PVRINOX", "SAREGAMA", "TIPSMUSIC", "NETWORK18",
        "TV18BRDCST", "NAZARA", "DBCORP", "HATHWAY", "DISHTV",
    ],
    "NIFTY PSU Bank": [
        "SBIN", "BANKBARODA", "PNB", "CANBK", "UNIONBANK", "INDIANB",
        "BANKINDIA", "MAHABANK", "CENTRALBK", "UCOBANK", "IOB", "PSB",
    ],
    "NIFTY Private Bank": [
        "HDFCBANK", "ICICIBANK", "KOTAKBANK", "AXISBANK", "INDUSINDBK",
        "FEDERALBNK", "IDFCFIRSTB", "BANDHANBNK", "RBLBANK", "YESBANK",
    ],
    "NIFTY Fin Services": [
        "HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "SBIN", "BAJFINANCE",
        "BAJAJFINSV", "JIOFIN", "SHRIRAMFIN", "HDFCLIFE", "SBILIFE", "ICICIPRULI",
        "HDFCAMC", "CHOLAFIN", "PFC", "RECLTD", "ICICIGI", "SBICARD",
        "MUTHOOTFIN", "LICHSGFIN",
    ],

    # ── Broad (not in indices.py) ─────────────────────────────────────────────
    "NIFTY Midcap 50": [
        "MAXHEALTH", "SUZLON", "PERSISTENT", "MAZDOCK", "IDEA", "COFORGE",
        "GODREJPROP", "LUPIN", "HDFCAMC", "INDHOTEL", "PHOENIXLTD", "OBEROIRLTY",
        "MPHASIS", "PAGEIND", "SUPREMEIND", "POLYCAB", "DIXON", "CGPOWER",
        "AUROPHARMA", "ASHOKLEY", "PATANJALI", "OFSS", "MOTHERSON", "MRF",
        "PIIND", "COLPAL", "MARICO", "TVSMOTOR", "CUMMINSIND", "SRF",
    ],

    # ── Thematic (representative; NSE revises periodically) ────────────────────
    "NIFTY Infra": [
        "RELIANCE", "BHARTIARTL", "LT", "NTPC", "POWERGRID", "ONGC", "ULTRACEMCO",
        "GRASIM", "ADANIPORTS", "INDIGO", "DLF", "SIEMENS", "BEL", "HAL", "GAIL",
        "IOC", "BPCL", "ADANIENSOL", "TATAPOWER", "INDUSTOWER", "NHPC",
        "GMRAIRPORT", "AMBUJACEM", "SHREECEM", "JSWENERGY", "TATACOMM", "OIL",
        "PETRONET",
    ],
    "NIFTY Commodities": [
        "RELIANCE", "ONGC", "ULTRACEMCO", "GRASIM", "JSWSTEEL", "TATASTEEL",
        "HINDALCO", "COALINDIA", "ADANIENT", "VEDL", "AMBUJACEM", "SHREECEM",
        "PIDILITIND", "UPL", "JINDALSTEL", "NMDC", "SAIL", "TATAPOWER", "GAIL",
        "PETRONET", "BPCL", "IOC", "HINDPETRO", "NATIONALUM", "JSWENERGY",
    ],
    "NIFTY Consumption": [
        "HINDUNILVR", "ITC", "MARUTI", "TITAN", "BHARTIARTL", "M&M", "NESTLEIND",
        "TRENT", "ASIANPAINT", "BAJAJ-AUTO", "DMART", "VBL", "EICHERMOT",
        "BRITANNIA", "GODREJCP", "TATACONSUM", "HEROMOTOCO", "DABUR", "INDIGO",
        "COLPAL", "HAVELLS", "MARICO", "UNITDSPR", "ETERNAL",
    ],
    "NIFTY PSE": [
        "NTPC", "POWERGRID", "ONGC", "COALINDIA", "BEL", "HAL", "GAIL", "IOC",
        "BPCL", "PFC", "RECLTD", "NHPC", "OIL", "SJVN", "NLCINDIA", "NBCC",
        "BHEL", "IRCTC", "IRFC", "RVNL", "NMDC", "SAIL", "CONCOR", "MAZDOCK",
        "COCHINSHIP", "BDL",
    ],
    "NIFTY MNC": [
        "MARUTI", "NESTLEIND", "BOSCHLTD", "SIEMENS", "ABB", "HINDUNILVR",
        "COLPAL", "BATAINDIA", "GILLETTE", "HONAUT", "3MINDIA", "CUMMINSIND",
        "GLAXO", "PFIZER", "ABBOTINDIA", "SCHAEFFLER", "TIMKEN", "WHIRLPOOL",
        "LINDEINDIA", "AMBUJACEM", "UNITDSPR", "BRITANNIA",
    ],
    "NIFTY Services": [
        "HDFCBANK", "ICICIBANK", "BHARTIARTL", "TCS", "INFY", "AXISBANK",
        "KOTAKBANK", "SBIN", "BAJFINANCE", "HCLTECH", "BAJAJFINSV", "SHRIRAMFIN",
        "HDFCLIFE", "SBILIFE", "TECHM", "WIPRO", "INDIGO", "ADANIPORTS", "DMART",
        "JIOFIN", "NAUKRI", "TRENT", "ZOMATO",
    ],
    "NIFTY Dividend Opps": [
        "COALINDIA", "ONGC", "NTPC", "POWERGRID", "IOC", "BPCL", "HINDZINC",
        "VEDL", "ITC", "HEROMOTOCO", "GAIL", "OIL", "PFC", "RECLTD", "NMDC",
        "HINDPETRO", "TATASTEEL", "BAJAJ-AUTO", "SAIL", "TECHM", "INFY", "HCLTECH",
        "NATIONALUM", "GODFRYPHLP", "CASTROLIND",
    ],
}


def get_constituents(index_name: str):
    """Return [{symbol, name}] for an index, or None if we have no list for it."""
    syms = None
    if index_name in _INDICES_PY_ALIAS:
        syms = INDICES.get(_INDICES_PY_ALIAS[index_name])
    elif index_name in _EXTRA:
        syms = _EXTRA[index_name]

    if not syms:
        return None

    seen, out = set(), []
    for s in syms:
        if s in seen:
            continue
        seen.add(s)
        out.append({"symbol": s, "name": SYMBOL_NAMES.get(s, s)})
    return out


# Thematic lists are curated snapshots, not tick-for-tick official — flag them so
# the UI can show a gentle "representative" note.
_REPRESENTATIVE = {
    "NIFTY Infra", "NIFTY Commodities", "NIFTY Consumption", "NIFTY PSE",
    "NIFTY MNC", "NIFTY Services", "NIFTY Dividend Opps", "NIFTY Midcap 50",
    "NIFTY Media",
}


def is_representative(index_name: str) -> bool:
    return index_name in _REPRESENTATIVE
