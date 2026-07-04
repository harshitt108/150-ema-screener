// Quarterly EPS / Sales scan — single chronological table, most recent
// quarter first, matching the screener.in-style layout the user referenced.
// Data: /api/financials/{symbol} (scraped from screener.in — see
// backend/fundamentals.py for why Yahoo's fundamentals API isn't used here).
//
// The scrape is deferred until the user opens this section: the parent renders
// FinancialScan only when its accordion is expanded (Accordion mounts children
// lazily), so the fetch-on-mount below never runs on a panel the user doesn't
// scroll into.
import { useState, useEffect } from 'react'

import { API_BASE } from '../apiBase'

const MONTHS = { '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
                 '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec' }

function quarterLabel(dateStr) {
  const [year, month] = dateStr.split('-')
  return `${MONTHS[month] || month}-${year.slice(2)}`
}

function fmtChg(pct) {
  if (pct == null) return <span className="text-slate-600">—</span>
  const cls = pct > 0 ? 'text-emerald-400' : pct < 0 ? 'text-rose-400' : 'text-slate-400'
  return <span className={`font-mono ${cls}`}>{pct > 0 ? '+' : ''}{pct}%</span>
}

function fmtNum(v) {
  if (v == null) return '—'
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

export default function FinancialScan({ symbol }) {
  const [financials, setFinancials] = useState(null)
  const [loading, setLoading] = useState(true)

  // Fetch on mount — and this component only mounts when the accordion is open,
  // so the screener.in scrape fires only when the user actually expands it.
  useEffect(() => {
    if (!symbol) return
    let cancelled = false
    setFinancials(null)
    setLoading(true)
    const sym = encodeURIComponent(symbol)
    fetch(`${API_BASE}/api/financials/${sym}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) { setFinancials(d); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [symbol])

  if (loading) {
    return <div className="h-24 flex items-center justify-center text-xs text-slate-600">Loading…</div>
  }
  if (!financials) {
    return <p className="text-xs text-slate-600">No quarterly financials found for this stock.</p>
  }
  const quarters = financials.quarters || []
  if (quarters.length === 0) {
    return <p className="text-xs text-slate-600">No quarterly financials found for this stock.</p>
  }

  const rows = quarters.slice().reverse()   // most recent quarter first

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-slate-500">
        Consolidated figures, ₹ Cr. %Chg is year-over-year (same quarter, previous year).
      </p>
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#1e1e30]">
            <th className="text-left text-[9px] font-semibold text-slate-500 uppercase py-1">Quarter</th>
            <th className="text-right text-[9px] font-semibold text-slate-500 uppercase py-1">EPS</th>
            <th className="text-right text-[9px] font-semibold text-slate-500 uppercase py-1">%Chg</th>
            <th className="text-right text-[9px] font-semibold text-slate-500 uppercase py-1">Sales</th>
            <th className="text-right text-[9px] font-semibold text-slate-500 uppercase py-1">%Chg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q, i) => (
            <tr key={i} className="border-b border-[#1e1e30]/50">
              <td className="py-1.5 text-xs font-mono text-slate-400">{quarterLabel(q.date)}</td>
              <td className="py-1.5 text-xs font-mono text-slate-200 text-right">{fmtNum(q.eps)}</td>
              <td className="py-1.5 text-xs text-right">{fmtChg(q.epsYoyPct)}</td>
              <td className="py-1.5 text-xs font-mono text-slate-200 text-right">{fmtNum(q.sales)}</td>
              <td className="py-1.5 text-xs text-right">{fmtChg(q.salesYoyPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
