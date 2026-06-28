export default function Sparkline({ prices, emaLine, width = 80, height = 32 }) {
  if (!prices || prices.length < 2) return <span className="text-slate-600 text-xs">—</span>

  const all = [...prices, ...emaLine]
  const min = Math.min(...all)
  const max = Math.max(...all)
  const range = max - min || 1

  const toX = (i) => (i / (prices.length - 1)) * width
  const toY = (v) => height - ((v - min) / range) * height

  const pricePath = prices.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(' ')
  const emaPath = emaLine.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(' ')

  const lastPrice = prices[prices.length - 1]
  const firstPrice = prices[0]
  const isUp = lastPrice >= firstPrice
  const priceColor = isUp ? '#10b981' : '#f43f5e'

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={pricePath} fill="none" stroke={priceColor} strokeWidth="1.5" strokeLinejoin="round" />
      <path d={emaPath} fill="none" stroke="#8b5cf6" strokeWidth="1" strokeDasharray="2,2" strokeLinejoin="round" />
    </svg>
  )
}
