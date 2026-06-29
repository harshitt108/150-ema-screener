from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
import csv
import io
import logging
import concurrent.futures

from database import get_db, Portfolio, Holding, ScanResult
from scan_engine import scan_portfolio, fetch_all_ema_status, fetch_ratio_conditions

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/portfolios", tags=["portfolios"])


# ─── Pydantic schemas ────────────────────────────────────────────────────────

class PortfolioCreate(BaseModel):
    name: str
    type: str = "custom"        # investment | swing | custom
    description: Optional[str] = None
    color: str = "#7c3aed"

class PortfolioUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None

class HoldingCreate(BaseModel):
    symbol: str
    quantity: Optional[float] = None
    avg_buy_price: Optional[float] = None
    buy_date: Optional[date] = None
    notes: Optional[str] = None

class HoldingUpdate(BaseModel):
    quantity: Optional[float] = None
    avg_buy_price: Optional[float] = None
    buy_date: Optional[date] = None
    notes: Optional[str] = None

class BulkHoldingCreate(BaseModel):
    holdings: list[HoldingCreate]


# ─── Serializers ─────────────────────────────────────────────────────────────

def _holding_dict(h: Holding) -> dict:
    return {
        "id": h.id,
        "portfolioId": h.portfolio_id,
        "symbol": h.symbol.upper(),
        "quantity": h.quantity,
        "avgBuyPrice": h.avg_buy_price,
        "buyDate": h.buy_date.isoformat() if h.buy_date else None,
        "notes": h.notes,
        "addedAt": h.added_at.isoformat() if h.added_at else None,
    }

def _portfolio_dict(p: Portfolio, include_holdings: bool = True, db=None) -> dict:
    d = {
        "id": p.id,
        "name": p.name,
        "type": p.type,
        "description": p.description,
        "color": p.color,
        "createdAt": p.created_at.isoformat() if p.created_at else None,
        "holdingCount": len(p.holdings),
        "healthScore": None,
        "healthCategory": None,
        "lastScannedAt": None,
    }
    if db is not None:
        last = (
            db.query(ScanResult)
            .filter(ScanResult.portfolio_id == p.id)
            .order_by(ScanResult.scanned_at.desc())
            .first()
        )
        if last:
            d["healthScore"]    = last.health_score
            d["healthCategory"] = last.health_category
            d["lastScannedAt"]  = last.scanned_at.isoformat()
    if include_holdings:
        d["holdings"] = [_holding_dict(h) for h in p.holdings]
    return d


# ─── Portfolio CRUD ───────────────────────────────────────────────────────────

@router.get("")
def list_portfolios(db: Session = Depends(get_db)):
    portfolios = db.query(Portfolio).order_by(Portfolio.created_at).all()
    return [_portfolio_dict(p, include_holdings=False, db=db) for p in portfolios]


@router.post("")
def create_portfolio(body: PortfolioCreate, db: Session = Depends(get_db)):
    p = Portfolio(name=body.name, type=body.type,
                  description=body.description, color=body.color)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _portfolio_dict(p)


@router.get("/{portfolio_id}")
def get_portfolio(portfolio_id: int, db: Session = Depends(get_db)):
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return _portfolio_dict(p)


@router.put("/{portfolio_id}")
def update_portfolio(portfolio_id: int, body: PortfolioUpdate, db: Session = Depends(get_db)):
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    if body.name is not None:
        p.name = body.name
    if body.type is not None:
        p.type = body.type
    if body.description is not None:
        p.description = body.description
    if body.color is not None:
        p.color = body.color
    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return _portfolio_dict(p)


@router.delete("/{portfolio_id}")
def delete_portfolio(portfolio_id: int, db: Session = Depends(get_db)):
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    db.delete(p)
    db.commit()
    return {"ok": True}


# ─── Holdings CRUD ────────────────────────────────────────────────────────────

def _upsert_holding(db, portfolio_id, symbol, quantity=None, avg_buy_price=None,
                    buy_date=None, notes=None):
    """Insert a holding, or update the existing one for this (portfolio, symbol).

    Prevents duplicate rows when the same symbol is added again or a broker file
    is re-uploaded. Only non-None incoming values overwrite existing fields, so a
    re-upload that omits a field won't wipe it. Returns (holding, created)."""
    symbol = (symbol or "").upper().strip().replace(" ", "")
    if not symbol:
        return None, False
    existing = (
        db.query(Holding)
        .filter(Holding.portfolio_id == portfolio_id, Holding.symbol == symbol)
        .first()
    )
    if existing:
        if quantity      is not None: existing.quantity      = quantity
        if avg_buy_price is not None: existing.avg_buy_price = avg_buy_price
        if buy_date      is not None: existing.buy_date      = buy_date
        if notes         is not None: existing.notes         = notes
        return existing, False
    h = Holding(portfolio_id=portfolio_id, symbol=symbol, quantity=quantity,
                avg_buy_price=avg_buy_price, buy_date=buy_date, notes=notes)
    db.add(h)
    return h, True


@router.post("/{portfolio_id}/holdings")
def add_holding(portfolio_id: int, body: HoldingCreate, db: Session = Depends(get_db)):
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    h, _ = _upsert_holding(db, portfolio_id, body.symbol, body.quantity,
                           body.avg_buy_price, body.buy_date, body.notes)
    db.commit()
    db.refresh(h)
    return _holding_dict(h)


@router.post("/{portfolio_id}/holdings/bulk")
def add_holdings_bulk(portfolio_id: int, body: BulkHoldingCreate, db: Session = Depends(get_db)):
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    added, updated = [], []
    for item in body.holdings:
        h, created = _upsert_holding(db, portfolio_id, item.symbol, item.quantity,
                                     item.avg_buy_price, item.buy_date, item.notes)
        if h is None:
            continue
        (added if created else updated).append(h.symbol)
    db.commit()
    db.refresh(p)
    return {"added": len(added), "updated": updated,
            "holdings": [_holding_dict(h) for h in p.holdings]}


@router.put("/{portfolio_id}/holdings/{holding_id}")
def update_holding(portfolio_id: int, holding_id: int, body: HoldingUpdate,
                   db: Session = Depends(get_db)):
    h = db.get(Holding, holding_id)
    if not h or h.portfolio_id != portfolio_id:
        raise HTTPException(status_code=404, detail="Holding not found")
    if body.quantity is not None:
        h.quantity = body.quantity
    if body.avg_buy_price is not None:
        h.avg_buy_price = body.avg_buy_price
    if body.buy_date is not None:
        h.buy_date = body.buy_date
    if body.notes is not None:
        h.notes = body.notes
    db.commit()
    db.refresh(h)
    return _holding_dict(h)


@router.delete("/{portfolio_id}/holdings/{holding_id}")
def delete_holding(portfolio_id: int, holding_id: int, db: Session = Depends(get_db)):
    h = db.get(Holding, holding_id)
    if not h or h.portfolio_id != portfolio_id:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(h)
    db.commit()
    return {"ok": True}


# ─── CSV / text upload ────────────────────────────────────────────────────────

_ISIN_CACHE: dict = {}


def _isin_to_nse_symbol(isin: str) -> Optional[str]:
    """Resolve an ISIN to an NSE/BSE ticker via Yahoo Finance autocomplete."""
    isin = isin.strip().upper()
    if isin in _ISIN_CACHE:
        return _ISIN_CACHE[isin]
    try:
        from data_fetcher import SESSION
        resp = SESSION.get(
            "https://query1.finance.yahoo.com/v6/finance/autocomplete",
            params={"query": isin, "lang": "en", "region": "IN"},
            timeout=10,
        )
        results = resp.json().get("ResultSet", {}).get("Result", [])
        # Prefer NSE (.NS) results; fall back to any first result
        for r in results:
            sym = (r.get("symbol") or "").strip()
            if sym.endswith(".NS") or r.get("exch") == "NSI":
                resolved = sym.replace(".NS", "").replace(".BO", "")
                _ISIN_CACHE[isin] = resolved
                return resolved
        if results:
            sym = (results[0].get("symbol") or "").strip()
            resolved = sym.replace(".NS", "").replace(".BO", "")
            _ISIN_CACHE[isin] = resolved
            return resolved
    except Exception:
        pass
    _ISIN_CACHE[isin] = None
    return None


def _parse_broker_excel_bytes(data: bytes):
    """Parse broker-style holding report Excel (Zerodha, Groww, Angel, etc.).
    Detects the data table by scanning for a header row with 'Stock Name'/'Scrip' + 'ISIN'.
    Resolves each ISIN to NSE symbol concurrently via Yahoo Finance autocomplete.
    Returns (parsed_holdings, unresolved_names).
    """
    import openpyxl
    # NOTE: read_only=True trusts the stored sheet dimension, which broker
    # exports often set wrong (only row 1). Use the normal loader so openpyxl
    # recomputes the real used range and we see every data row.
    wb = openpyxl.load_workbook(filename=io.BytesIO(data), read_only=False, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    def _clean(c):
        if c is None:
            return ""
        return str(c).strip().replace("\n", " ").replace("\r", " ").lower()

    # Find the header row: must have an ISIN column AND a name/symbol column
    # Be flexible — different brokers use different column names
    NAME_KEYWORDS  = ("stock name", "scrip name", "instrument", "company", "symbol", "stock", "scrip", "name of")
    ISIN_KEYWORDS  = ("isin",)

    header_idx = None
    for i, row in enumerate(rows):
        cells = [_clean(c) for c in row]
        has_name = any(any(k in c for k in NAME_KEYWORDS) for c in cells if c)
        has_isin = any(any(k in c for k in ISIN_KEYWORDS) for c in cells if c)
        if has_name and has_isin:
            header_idx = i
            break

    if header_idx is None:
        return [], []

    header = [_clean(c) for c in rows[header_idx]]

    def find_col(*keywords):
        for i, h in enumerate(header):
            if any(k in h for k in keywords):
                return i
        return None

    col_name  = find_col("stock name", "scrip name", "instrument", "company", "symbol", "scrip", "name")
    col_isin  = find_col("isin")
    col_qty   = find_col("quantity", "qty", "shares", "units")
    col_price = find_col("average b", "avg", "average price", "buy price", "purchase", "cost")

    if col_isin is None:
        return [], []

    def _get(row, idx):
        if idx is None or idx >= len(row):
            return None
        return row[idx]

    # Collect raw data rows — only rows with a valid Indian ISIN (INE/INF prefix)
    raw_entries = []
    for row in rows[header_idx + 1:]:
        if not row or all(c is None for c in row):
            continue
        raw_isin = _get(row, col_isin)
        if not raw_isin:
            continue
        isin_str = str(raw_isin).strip().upper()
        # Valid ISIN: 12 chars, starts with 2-letter country code
        if len(isin_str) < 10 or not isin_str[:2].isalpha():
            continue
        raw_name  = str(_get(row, col_name)  or "").strip()
        raw_qty   = _get(row, col_qty)
        raw_price = _get(row, col_price)
        raw_entries.append((isin_str, raw_name, raw_qty, raw_price))

    if not raw_entries:
        return [], []

    # Resolve unique ISINs concurrently
    unique_isins = list({e[0] for e in raw_entries})
    isin_map: dict = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(_isin_to_nse_symbol, isin): isin for isin in unique_isins}
        for f in concurrent.futures.as_completed(futures):
            isin_map[futures[f]] = f.result()

    results, unresolved = [], []
    for isin_str, raw_name, raw_qty, raw_price in raw_entries:
        symbol = isin_map.get(isin_str)
        if not symbol:
            unresolved.append(raw_name or isin_str)
            continue
        entry = {
            "symbol": symbol.upper().strip().replace(" ", ""),
            "quantity": None, "avg_buy_price": None,
            "buy_date": None, "notes": f"ISIN: {isin_str}",
        }
        try:
            if raw_qty is not None:
                entry["quantity"] = float(raw_qty)
        except (ValueError, TypeError):
            pass
        try:
            if raw_price is not None:
                entry["avg_buy_price"] = float(raw_price)
        except (ValueError, TypeError):
            pass
        results.append(entry)

    return results, unresolved


def _parse_excel_bytes(data: bytes) -> list[dict]:
    """Parse an .xlsx workbook into the same list[dict] format as _parse_upload_text.
    Supports files with a header row or bare positional columns (sym, qty, price, date, notes).
    """
    import openpyxl
    wb = openpyxl.load_workbook(filename=io.BytesIO(data), read_only=False, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []

    first = [str(c).strip().lower() if c is not None else "" for c in rows[0]]

    sym_keys   = {"symbol", "ticker", "scrip", "stock", "name"}
    qty_keys   = {"qty", "quantity", "shares", "units"}
    price_keys = {"avg_price", "avg price", "price", "buy_price", "buy price",
                  "average price", "average_price", "cost"}
    date_keys  = {"date", "buy_date", "purchase_date", "buy date"}
    notes_keys = {"notes", "note", "remarks", "comment", "comments"}
    all_keys   = sym_keys | qty_keys | price_keys | date_keys | notes_keys

    has_header = any(c in all_keys for c in first)

    if has_header:
        col_sym   = next((i for i, c in enumerate(first) if c in sym_keys),   None)
        col_qty   = next((i for i, c in enumerate(first) if c in qty_keys),   None)
        col_price = next((i for i, c in enumerate(first) if c in price_keys), None)
        col_date  = next((i for i, c in enumerate(first) if c in date_keys),  None)
        col_notes = next((i for i, c in enumerate(first) if c in notes_keys), None)
        data_rows = rows[1:]
    else:
        col_sym, col_qty, col_price, col_date, col_notes = 0, 1, 2, 3, 4
        data_rows = rows

    results = []
    for row in data_rows:
        if not row or all(c is None for c in row):
            continue

        def _get(idx):
            if idx is None or idx >= len(row):
                return None
            return row[idx]

        raw_sym = _get(col_sym)
        if raw_sym is None:
            continue
        sym = str(raw_sym).upper().strip().replace(" ", "")
        if not sym or sym.startswith("#"):
            continue

        entry = {"symbol": sym, "quantity": None, "avg_buy_price": None,
                 "buy_date": None, "notes": None}
        try:
            v = _get(col_qty)
            if v is not None:
                entry["quantity"] = float(v)
        except (ValueError, TypeError):
            pass
        try:
            v = _get(col_price)
            if v is not None:
                entry["avg_buy_price"] = float(v)
        except (ValueError, TypeError):
            pass
        try:
            v = _get(col_date)
            if v is not None:
                if isinstance(v, datetime):
                    entry["buy_date"] = v.date()
                elif isinstance(v, date):
                    entry["buy_date"] = v
                else:
                    entry["buy_date"] = date.fromisoformat(str(v).strip())
        except (ValueError, TypeError):
            pass
        v = _get(col_notes)
        if v is not None:
            entry["notes"] = str(v)

        results.append(entry)
    return results


def _parse_upload_text(text: str) -> list[dict]:
    """Parse CSV or plain symbol list.

    Supported formats:
      • SYMBOL                          (symbol only)
      • SYMBOL,QTY,AVG_PRICE
      • SYMBOL,QTY,AVG_PRICE,BUY_DATE
      • SYMBOL,QTY,AVG_PRICE,BUY_DATE,NOTES
    """
    results = []
    reader = csv.reader(io.StringIO(text.strip()))
    for row in reader:
        row = [c.strip() for c in row if c.strip()]
        if not row:
            continue
        sym = row[0].upper().strip().replace(" ", "")
        if not sym or sym.startswith("#"):
            continue
        entry = {"symbol": sym, "quantity": None, "avg_buy_price": None,
                 "buy_date": None, "notes": None}
        try:
            if len(row) >= 2:
                entry["quantity"] = float(row[1])
            if len(row) >= 3:
                entry["avg_buy_price"] = float(row[2])
            if len(row) >= 4 and row[3]:
                entry["buy_date"] = date.fromisoformat(row[3])
            if len(row) >= 5:
                entry["notes"] = row[4]
        except (ValueError, TypeError):
            pass  # partial data is fine
        results.append(entry)
    return results


@router.post("/{portfolio_id}/upload")
async def upload_holdings(portfolio_id: int, file: UploadFile = File(...),
                          db: Session = Depends(get_db)):
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    raw = await file.read()
    fname = (file.filename or "").lower()
    unresolved: list[str] = []

    if fname.endswith(".xlsx") or fname.endswith(".xls"):
        try:
            # Try broker format first (header row with 'Stock Name' + 'ISIN')
            parsed, unresolved = _parse_broker_excel_bytes(raw)
            logger.info(f"[upload] broker parse: parsed={len(parsed)} unresolved={len(unresolved)}")
            if not parsed and not unresolved:
                # Fall back to plain column-based Excel (symbol/qty/price)
                logger.info("[upload] broker header not detected, falling back to plain Excel parser")
                parsed = _parse_excel_bytes(raw)
        except Exception as exc:
            logger.exception(f"[upload] Excel parse error: {exc}")
            raise HTTPException(status_code=400, detail=f"Could not read Excel file: {exc}")
    else:
        parsed = _parse_upload_text(raw.decode("utf-8", errors="replace"))

    if not parsed:
        msg = "No valid symbols found in file"
        if unresolved:
            msg += f". Could not resolve: {', '.join(unresolved[:5])}"
        raise HTTPException(status_code=400, detail=msg)

    added, updated = [], []
    for item in parsed:
        h, created = _upsert_holding(db, portfolio_id, item["symbol"], item["quantity"],
                                     item["avg_buy_price"], item["buy_date"], item["notes"])
        if h is None:
            continue
        (added if created else updated).append(h.symbol)
    db.commit()
    db.refresh(p)
    return {"added": len(added), "updated": updated, "symbols": added + updated,
            "unresolved": unresolved, "holdings": [_holding_dict(h) for h in p.holdings]}


@router.post("/{portfolio_id}/paste")
def paste_symbols(portfolio_id: int, body: dict, db: Session = Depends(get_db)):
    """Accept raw pasted text (symbols one per line or comma-separated)."""
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    def _is_num(s):
        try:
            float(str(s).strip()); return True
        except (ValueError, TypeError):
            return False

    # A line can be either a "SYMBOL,QTY,PRICE[,DATE,NOTES]" row OR a list of
    # bare symbols ("TCS, RELIANCE, INFY"). Disambiguate per line: if the 2nd
    # comma field is numeric it's a data row; otherwise every token is a symbol.
    raw = body.get("text", "")
    out_lines = []
    for line in raw.replace(";", "\n").splitlines():
        fields = [f.strip() for f in line.split(",") if f.strip()]
        if not fields:
            continue
        if len(fields) >= 2 and _is_num(fields[1]):
            out_lines.append(",".join(fields))   # SYMBOL,QTY,PRICE,… row
        else:
            out_lines.extend(fields)             # each token is its own symbol
    parsed = _parse_upload_text("\n".join(out_lines))
    if not parsed:
        raise HTTPException(status_code=400, detail="No valid symbols found")

    added, updated = [], []
    for item in parsed:
        h, created = _upsert_holding(db, portfolio_id, item["symbol"], item["quantity"],
                                     item["avg_buy_price"], item["buy_date"], item["notes"])
        if h is None:
            continue
        (added if created else updated).append(h.symbol)
    db.commit()
    db.refresh(p)
    return {"added": len(added), "updated": updated, "symbols": added + updated,
            "holdings": [_holding_dict(h) for h in p.holdings]}


# ─── EMA status refresh (full scan — stores results + health score) ───────────

@router.post("/{portfolio_id}/refresh-status")
def refresh_status(portfolio_id: int, db: Session = Depends(get_db)):
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    if not p.holdings:
        return {"status": {}, "health": None, "crosses": [], "noData": []}

    result = scan_portfolio(portfolio_id, db)
    if not result:
        raise HTTPException(status_code=500, detail="Scan failed")
    return result


# ─── Live EMA fetch for any timeframe (no scan, no DB write) ─────────────────

@router.get("/{portfolio_id}/ema-status")
def get_ema_status(
    portfolio_id: int,
    timeframe: str = "daily",
    benchmark: str = "NIFTY 50",
    db: Session = Depends(get_db),
):
    """Fetch live EMA data + ratio conditions for all holdings at the given timeframe.
    Does NOT persist anything — just a live data fetch.
    """
    p = db.get(Portfolio, portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    symbols = list({h.symbol for h in p.holdings})
    if not symbols:
        return {"status": {}, "noData": [], "ratioConditions": {}, "timeframe": timeframe}

    # Fetch EMA status and ratio conditions concurrently
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        f_ema   = ex.submit(fetch_all_ema_status, symbols, timeframe)
        f_ratio = ex.submit(fetch_ratio_conditions, symbols, timeframe, benchmark)
        status_map, no_data = f_ema.result()
        ratio_conds = f_ratio.result()

    return {
        "status":          status_map,
        "noData":          no_data,
        "ratioConditions": ratio_conds,
        "timeframe":       timeframe,
        "benchmark":       benchmark,
    }
