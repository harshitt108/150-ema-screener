"""
Quarterly EPS / Sales for the Financial Scan panel.

Yahoo Finance's fundamentals API caps out at ~4-5 trailing quarters for NSE
stocks (confirmed directly against its quoteSummary AND fundamentals-timeseries
endpoints) — nowhere near enough for a multi-year YoY quarterly view. screener.in
renders the full quarterly results table (typically 3+ years) as plain
server-side HTML with stable `data-date-key` attributes, so it's scraped here
instead. This is screen-scraping, not an API — it can break if screener.in
changes their markup, and carries the usual scraping ToS caveats.
"""
import re
from typing import Optional

import requests
from bs4 import BeautifulSoup

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
})

SCREENER_BASE = "https://www.screener.in/company"


def _parse_number(text: str) -> Optional[float]:
    text = text.replace("\xa0", " ").strip().replace(",", "")
    if not text or text in ("-", "—"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _clean_label(text: str) -> str:
    text = text.replace("\xa0", " ").replace("+", " ")
    return re.sub(r"\s+", " ", text).strip()


def _fetch_quarters_table(symbol: str):
    """Try consolidated financials first, fall back to standalone — some
    companies (mostly ones without subsidiaries) only have standalone."""
    for path in (f"{symbol}/consolidated/", f"{symbol}/"):
        try:
            resp = SESSION.get(f"{SCREENER_BASE}/{path}", timeout=12)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue

        soup = BeautifulSoup(resp.text, "html.parser")
        section = soup.find("section", id="quarters")
        if not section:
            continue
        table = section.find("table")
        if not table:
            continue

        thead = table.find("thead")
        if not thead:
            continue
        headers = thead.find_all("th")[1:]
        dates = [th.get("data-date-key") for th in headers]
        if not dates or any(d is None for d in dates):
            continue

        rows_by_label = {}
        tbody = table.find("tbody")
        if tbody:
            for tr in tbody.find_all("tr", recursive=False):
                cells = tr.find_all("td")
                if not cells:
                    continue
                label = _clean_label(cells[0].get_text())
                values = [_parse_number(td.get_text()) for td in cells[1:]]
                rows_by_label[label] = values

        return dates, rows_by_label
    return None


def fetch_quarterly_financials(symbol: str) -> Optional[dict]:
    """Returns {"symbol", "quarters": [{date, sales, eps, salesYoyPct, epsYoyPct}]}
    sorted oldest-to-newest, or None if screener.in has no data for this symbol.
    YoY %Chg compares each quarter to the same quarter 4 slots earlier — matches
    screener.in's own YoY convention (Mar this year vs Mar last year, not
    Mar vs the preceding Dec)."""
    result = _fetch_quarters_table(symbol)
    if not result:
        return None
    dates, rows_by_label = result

    sales = rows_by_label.get("Sales") or rows_by_label.get("Revenue")
    eps = rows_by_label.get("EPS in Rs")
    if sales is None or eps is None:
        return None

    n = min(len(dates), len(sales), len(eps))
    quarters = [{"date": dates[i], "sales": sales[i], "eps": eps[i]} for i in range(n)]

    def yoy(cur, prev):
        if cur is None or prev is None or prev == 0:
            return None
        return round((cur - prev) / prev * 100, 1)

    for i, q in enumerate(quarters):
        prev = quarters[i - 4] if i - 4 >= 0 else None
        q["salesYoyPct"] = yoy(q["sales"], prev["sales"]) if prev else None
        q["epsYoyPct"] = yoy(q["eps"], prev["eps"]) if prev else None

    # YoY is computed against the full fetched history above (so the 4 oldest
    # quarters we drop here still correctly fed the YoY base for what remains)
    # — cap the returned table at the most recent 12 quarters (3 years).
    return {"symbol": symbol, "quarters": quarters[-12:]}
