import Chip from './Chip'

// Splits the existing signal conditions (same data as the top chip bar) into
// bullish vs bearish groups — rendered as the same compact pills, just
// regrouped by direction instead of by indicator category.
export default function BullBearFactors({ conditions }) {
  if (!conditions) return null

  const entries = Object.values(conditions)
  const bullish = entries.filter(c => c.bull)
  const bearish = entries.filter(c => !c.bull)

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-1.5">
          Bullish ({bullish.length})
        </p>
        {bullish.length === 0 ? (
          <p className="text-xs text-slate-600">None</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {bullish.map((c, i) => <Chip key={i} label={c.label} val={c.val} bull />)}
          </div>
        )}
      </div>
      <div>
        <p className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider mb-1.5">
          Bearish ({bearish.length})
        </p>
        {bearish.length === 0 ? (
          <p className="text-xs text-slate-600">None</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {bearish.map((c, i) => <Chip key={i} label={c.label} val={c.val} bull={false} />)}
          </div>
        )}
      </div>
    </div>
  )
}
