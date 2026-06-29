// Shared compact indicator cells used by EVERY table (EMA scanner, RS screener,
// Portfolio, Watchlist) so the EMA / Ratio / Momentum columns look identical
// everywhere. Each is a stacked list of colored dots: green = bullish, red = bearish.

const Dash = () => <span className="text-slate-700 text-xs">—</span>

function DotRow({ label, bull, value }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${bull ? 'bg-emerald-400' : 'bg-rose-500'}`} />
      <span className="text-[10px] text-slate-500 w-9">{label}</span>
      <span className={`text-[10px] font-mono ${bull ? 'text-emerald-400' : 'text-rose-400'}`}>{value}</span>
    </div>
  )
}

// EMA panels come in two key styles: { ema20,... } (scanner) or { "20",... } (portfolio)
function pick(panel, n) {
  if (!panel) return null
  return panel[`ema${n}`] ?? panel[String(n)] ?? null
}

function fmtPct(v) {
  const x = Number(v ?? 0)
  return `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`
}

/** 20 / 50 / 150 vs price EMA (or ratio EMA — same shape). */
export function EmaGroup({ panel }) {
  if (!panel) return <Dash />
  const rows = [20, 50, 150].map(n => [n, pick(panel, n)]).filter(([, d]) => d)
  if (!rows.length) return <Dash />
  return (
    <div className="flex flex-col gap-0.5 items-start">
      {rows.map(([n, d]) => (
        <DotRow key={n} label={String(n)} bull={d.above} value={fmtPct(d.dist)} />
      ))}
    </div>
  )
}

// Ratio uses the identical layout
export const RatioGroup = EmaGroup

// Normalize momentum from either a full `signals` object (with .conditions)
// or an already-extracted { rsi, macd, aroon } dict (portfolio status).
export function extractMomentum(src) {
  if (!src) return null
  const c = src.conditions || src
  const g = (k) => (c && c[k]) ? { bull: !!c[k].bull, val: c[k].val } : null
  return {
    rsi:   g('rsi_gt_50')      || src.rsi   || null,
    macd:  g('macd_gt_signal') || src.macd  || null,
    aroon: g('aroon_bull')     || src.aroon || null,
  }
}

/** RSI(14)>50 · MACD>Signal · Aroon(25) — bullish/bearish. */
export function MomentumGroup({ source }) {
  const m = extractMomentum(source)
  if (!m || (!m.rsi && !m.macd && !m.aroon)) return <Dash />
  const rows = [['RSI', m.rsi], ['MACD', m.macd], ['Aroon', m.aroon]].filter(([, d]) => d)
  return (
    <div className="flex flex-col gap-0.5 items-start">
      {rows.map(([lbl, d]) => <DotRow key={lbl} label={lbl} bull={d.bull} value={String(d.val)} />)}
    </div>
  )
}
