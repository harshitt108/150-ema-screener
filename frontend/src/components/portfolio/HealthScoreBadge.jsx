const CATEGORY_STYLES = {
  Excellent: { ring: '#10b981', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', label: 'text-emerald-300' },
  Healthy:   { ring: '#22c55e', text: 'text-green-400',   bg: 'bg-green-500/10',   border: 'border-green-500/25',   label: 'text-green-300'   },
  Watch:     { ring: '#eab308', text: 'text-yellow-400',  bg: 'bg-yellow-500/10',  border: 'border-yellow-500/25',  label: 'text-yellow-300'  },
  Weakening: { ring: '#f97316', text: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/25',  label: 'text-orange-300'  },
  Critical:  { ring: '#ef4444', text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/25',    label: 'text-rose-300'    },
  Unknown:   { ring: '#475569', text: 'text-slate-400',   bg: 'bg-slate-500/10',   border: 'border-slate-500/25',   label: 'text-slate-400'   },
}

/** Compact inline badge — used on portfolio cards */
export function HealthScoreChip({ score, category }) {
  const s = CATEGORY_STYLES[category] || CATEGORY_STYLES.Unknown
  if (score == null) return null
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${s.bg} ${s.border} ${s.text}`}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.ring }} />
      {score} · {category}
    </span>
  )
}

/** Large circular gauge — used on portfolio detail */
export function HealthScoreGauge({ score, category, details }) {
  const s    = CATEGORY_STYLES[category] || CATEGORY_STYLES.Unknown
  const pct  = score ?? 0
  const r    = 28
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ

  return (
    <div className={`flex items-center gap-4 px-5 py-4 rounded-2xl border ${s.bg} ${s.border}`}>
      {/* Circular progress */}
      <div className="relative flex-shrink-0 w-[72px] h-[72px]">
        <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
          <circle cx="36" cy="36" r={r} fill="none" stroke="#1e1e30" strokeWidth="6" />
          <circle
            cx="36" cy="36" r={r} fill="none"
            stroke={s.ring} strokeWidth="6"
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-xl font-bold leading-none ${s.text}`}>{score ?? '—'}</span>
        </div>
      </div>

      {/* Text side */}
      <div>
        <p className="text-xs text-slate-500 mb-0.5">Portfolio Health</p>
        <p className={`text-base font-bold ${s.text}`}>{category ?? '—'}</p>
        {details && (
          <p className="text-xs text-slate-500 mt-1">
            {details.above150}/{details.total} above 150 EMA
            <span className="ml-1 text-[10px] text-slate-600">(Daily)</span>
          </p>
        )}
      </div>
    </div>
  )
}

/** Breakdown bar — shows each EMA layer (Daily timeframe, always).
 *  All four EMAs are shown with their exact score weight, and each bar uses its
 *  own denominator (holdings that HAVE that EMA), so the display matches the
 *  score computed in the backend even when some holdings lack 200-bar history. */
export function HealthBreakdown({ details }) {
  if (!details || !details.total) return null
  const bars = [
    { label: '150 EMA', count: details.above150, denom: details.counted150 ?? details.total, weight: '40%', color: '#7c3aed' },
    { label: '50 EMA',  count: details.above50,  denom: details.counted50  ?? details.total, weight: '25%', color: '#2563eb' },
    { label: '200 EMA', count: details.above200, denom: details.counted200 ?? details.total, weight: '20%', color: '#0891b2' },
    { label: '20 EMA',  count: details.above20,  denom: details.counted20  ?? details.total, weight: '15%', color: '#059669' },
  ]
  return (
    <div className="space-y-2.5">
      {bars.map(b => (
        <div key={b.label} className="flex items-center gap-3">
          <span className="text-xs text-slate-500 w-14 flex-shrink-0">{b.label}</span>
          <div className="flex-1 h-1.5 bg-[#1e1e30] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: b.denom ? `${(b.count / b.denom) * 100}%` : '0%', backgroundColor: b.color }}
            />
          </div>
          <span className="text-xs text-slate-400 w-12 text-right flex-shrink-0">
            {b.count}/{b.denom || 0}
          </span>
          <span className="text-xs text-slate-600 w-8 text-right flex-shrink-0">{b.weight}</span>
        </div>
      ))}
    </div>
  )
}
