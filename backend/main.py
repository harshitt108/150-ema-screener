from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import logging

from indices import INDEX_NAMES, get_symbols
from scanner import scan_stocks

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="NSE EMA Scanner", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScanRequest(BaseModel):
    indices: list[str] = Field(default=["NIFTY 50"])
    timeframe: str = Field(default="daily")
    ema_period: int = Field(default=150)
    condition: str = Field(default="near_ema")
    distance_pct: float = Field(default=3.0)
    cross_lookback: int = Field(default=3)


@app.get("/api/indices")
def get_indices():
    return {"indices": INDEX_NAMES}


@app.post("/api/scan")
def scan(req: ScanRequest):
    logger.info(f"Scan request: {req}")

    # Validate indices
    valid = [i for i in req.indices if i in INDEX_NAMES]
    if not valid:
        raise HTTPException(status_code=400, detail="No valid indices provided")

    symbols = get_symbols(valid)
    if not symbols:
        raise HTTPException(status_code=400, detail="No symbols found for selected indices")

    logger.info(f"Scanning {len(symbols)} symbols...")

    results = scan_stocks(
        symbols=symbols,
        timeframe=req.timeframe,
        ema_period=req.ema_period,
        condition=req.condition,
        distance_pct=req.distance_pct,
        cross_lookback=req.cross_lookback,
    )

    return {
        "results": results,
        "scanned": len(symbols),
        "found": len(results),
    }


@app.get("/health")
def health():
    return {"status": "ok"}
