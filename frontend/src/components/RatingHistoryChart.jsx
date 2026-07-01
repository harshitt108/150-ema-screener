const RATING_COLOR = {
  'Strong Buy':  '#34d399',
  'Buy':         '#60a5fa',
  'Hold':        '#fbbf24',
  'Sell':        '#fb923c',
  'Strong Sell': '#f43f5e',
}

function TrendLine({ history, width = 460, height = 70 }) {
  if (history.length < 2) return null
  const scores = history.map(h => h.score)
  const min = Math.min(...scores, 0)
  const max = Math.max(...scores, 100)
  const range = (max - min) || 1
  const toX = i => (i / (history.length - 1)) * width
  const toY = v => height - ((v - min) / range) * height

  const path = history.map((h, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(h.score).toFixed(1)}`).join(' ')
  const areaPath = `${path} L${width},${height} L0,${height} Z`

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
      <path d={areaPath} fill="#10b98120" />
      <path d={path} fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinejoin="round" />
      {history.map((h, i) => (
        <circle key={i} cx={toX(i)} cy={toY(h.score)} r="3" fill={RATING_COLOR[h.rating] || '#94a3b8'} />
      ))}
    </svg>
  )
}

export default function RatingHistoryChart({ ratingHistory }) {
  if (!ratingHistory) {
    return <div className="h-24 flex items-center justify-center text-xs text-slate-600">Loading…</div>
  }
  const history = ratingHistory.history || []
  if (history.length === 0) {
    return <p className="text-xs text-slate-600">Not enough history to compute a rating trend.</p>
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] text-slate-500 mb-1">Score trend · last {history.length} trading days</p>
        <TrendLine history={history} />
      </div>
      <div className="max-h-56 overflow-y-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e1e30]">
              <th className="text-left text-[10px] font-semibold text-slate-500 uppercase py-1">Date</th>
              <th className="text-left text-[10px] font-semibold text-slate-500 uppercase py-1">Rating</th>
              <th className="text-right text-[10px] font-semibold text-slate-500 uppercase py-1">Score</th>
              <th className="text-right text-[10px] font-semibold text-slate-500 uppercase py-1">Change</th>
            </tr>
          </thead>
          <tbody>
            {history.slice().reverse().map((h, i) => (
              <tr key={i} className="border-b border-[#1e1e30]/50">
                <td className="py-1.5 text-xs font-mono text-slate-400">
                  {new Date(h.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </td>
                <td className="py-1.5 text-xs font-semibold" style={{ color: RATING_COLOR[h.rating] }}>{h.rating}</td>
                <td className="py-1.5 text-xs font-mono text-slate-300 text-right">{h.score}</td>
                <td className="py-1.5 text-xs font-mono text-right">
                  {h.change == null ? (
                    <span className="text-slate-600">—</span>
                  ) : (
                    <span className={h.change > 0 ? 'text-emerald-400' : h.change < 0 ? 'text-rose-400' : 'text-slate-500'}>
                      {h.change > 0 ? '+' : ''}{h.change}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
