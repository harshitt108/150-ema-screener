// Small pill used for every bull/bear condition across the sidebar — the
// top chip bar and the Bullish/Bearish Factors section share this exact look.
export default function Chip({ label, val, bull }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold font-mono
        border ${bull ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}
    >
      <span>{label} {val}</span>
      <span>{bull ? '▲' : '▼'}</span>
    </span>
  )
}
