export default function SignalHistoryList({ history }) {
  if (!history) {
    return <div className="h-24 flex items-center justify-center text-xs text-slate-600">Loading…</div>
  }
  const events = history.events || []
  if (events.length === 0) {
    return <p className="text-xs text-slate-600">No crossover events detected in the trailing window.</p>
  }
  // Backend returns oldest-first; show most recent event at the top.
  const recentFirst = events.slice().reverse()

  return (
    <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
      {recentFirst.map((e, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${e.type === 'bullish' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          <div>
            <p className="text-[10px] font-mono text-slate-500">
              {new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
            <p className={`text-xs ${e.type === 'bullish' ? 'text-emerald-300' : 'text-rose-300'}`}>{e.label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
