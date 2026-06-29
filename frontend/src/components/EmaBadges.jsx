// Compact vertical stack showing a series' position vs its 20 / 50 / 150 EMA.
// `panel` shape: { ema20: {above, dist} | null, ema50: {...}, ema150: {...} }

function EmaRow({ label, data }) {
  if (!data) {
    return (
      <div className="flex items-center gap-1 text-[11px] leading-tight text-slate-600">
        <span className="w-7 text-slate-500">{label}</span>
        <span>—</span>
      </div>
    )
  }
  const color = data.above ? 'text-emerald-400' : 'text-rose-400'
  const arrow = data.above ? '▲' : '▼'
  const sign = data.dist >= 0 ? '+' : ''
  return (
    <div className="flex items-center gap-1 text-[11px] leading-tight font-mono">
      <span className="w-7 text-slate-500">{label}</span>
      <span className={color}>{arrow}</span>
      <span className={color}>{sign}{data.dist.toFixed(2)}%</span>
    </div>
  )
}

export default function EmaBadges({ panel }) {
  if (!panel) return <span className="text-slate-600 text-xs">—</span>
  return (
    <div className="space-y-0.5">
      <EmaRow label="20" data={panel.ema20} />
      <EmaRow label="50" data={panel.ema50} />
      <EmaRow label="150" data={panel.ema150} />
    </div>
  )
}
