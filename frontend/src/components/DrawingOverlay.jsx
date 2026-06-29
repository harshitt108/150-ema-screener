/**
 * DrawingOverlay — interactive drawing tools on top of CandleChart.
 *
 * Key fixes vs previous version:
 *  - SVG uses CSS 100%/100%, NOT explicit pixel dimensions → always covers chart
 *  - Capture rect uses width/height="100%" → always covers full SVG
 *  - Coordinates computed from wrapRef.getBoundingClientRect() matching chart origin
 *  - SVG z-index: 1000 so it sits above lw-charts canvas elements
 *  - Better icons using inline SVG primitives so each tool is visually obvious
 */
import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'

// ─── Preset colours ────────────────────────────────────────────────────────
const COLORS = ['#e11d48', '#2196F3', '#16a34a', '#d97706', '#374151']

// ─── Extend a line (x1,y1)→(x2,y2) to both chart edges ────────────────────
function extendLine(x1, y1, x2, y2, W) {
  if (Math.abs(x2 - x1) < 0.5) return [x1, -9999, x1, 9999]
  const m = (y2 - y1) / (x2 - x1)
  return [0, y1 + m * (0 - x1), W, y1 + m * (W - x1)]
}

// ─── Inline SVG icons for each tool (16×16) ─────────────────────────────────
const ToolIcon = ({ id, size = 16, color = 'currentColor' }) => {
  const s = size, h = s / 2
  switch (id) {
    case 'cursor':
      return <svg width={s} height={s} viewBox="0 0 16 16"><path d="M3 1l10 6.5-5 1.5 2 5-2.5 1-2-5-3.5 3z" fill={color} /></svg>
    case 'hline':
      return <svg width={s} height={s} viewBox="0 0 16 16"><line x1="1" y1="8" x2="15" y2="8" stroke={color} strokeWidth="2"/><circle cx="4" cy="8" r="1.5" fill={color}/><circle cx="12" cy="8" r="1.5" fill={color}/></svg>
    case 'vline':
      return <svg width={s} height={s} viewBox="0 0 16 16"><line x1="8" y1="1" x2="8" y2="15" stroke={color} strokeWidth="2" strokeDasharray="2 2"/><circle cx="8" cy="4" r="1.5" fill={color}/><circle cx="8" cy="12" r="1.5" fill={color}/></svg>
    case 'trendline':
      return <svg width={s} height={s} viewBox="0 0 16 16"><line x1="2" y1="14" x2="14" y2="2" stroke={color} strokeWidth="2"/><circle cx="2" cy="14" r="2" fill={color}/><circle cx="14" cy="2" r="2" fill={color}/></svg>
    case 'channel':
      return <svg width={s} height={s} viewBox="0 0 16 16"><line x1="2" y1="12" x2="14" y2="4" stroke={color} strokeWidth="1.5"/><line x1="2" y1="15" x2="14" y2="7" stroke={color} strokeWidth="1.5"/><circle cx="2" cy="12" r="1.5" fill={color}/><circle cx="14" cy="4" r="1.5" fill={color}/></svg>
    case 'long':
      return <svg width={s} height={s} viewBox="0 0 16 16"><rect x="2" y="6" width="12" height="8" fill="#16a34a" opacity="0.25" rx="1"/><line x1="1" y1="6" x2="15" y2="6" stroke="#16a34a" strokeWidth="2"/><path d="M8 1l3 4H5z" fill="#16a34a"/></svg>
    case 'short':
      return <svg width={s} height={s} viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="8" fill="#dc2626" opacity="0.25" rx="1"/><line x1="1" y1="10" x2="15" y2="10" stroke="#dc2626" strokeWidth="2"/><path d="M8 15l3-4H5z" fill="#dc2626"/></svg>
    case 'text':
      return <svg width={s} height={s} viewBox="0 0 16 16"><text x="2" y="13" fontSize="13" fontWeight="bold" fill={color} fontFamily="serif">T</text></svg>
    default:
      return <svg width={s} height={s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" stroke={color} strokeWidth="2" fill="none"/></svg>
  }
}

const TOOLS = [
  { id: 'cursor',    label: 'Cursor (pan/zoom)'              },
  null,
  { id: 'hline',     label: 'Horizontal Line  — 1 click'     },
  { id: 'vline',     label: 'Vertical Line  — 1 click'       },
  { id: 'trendline', label: 'Trendline  — 2 clicks'          },
  { id: 'channel',   label: 'Parallel Channel  — 3 clicks'   },
  null,
  { id: 'long',      label: 'Long Position  — 2 clicks'      },
  { id: 'short',     label: 'Short Position  — 2 clicks'     },
  null,
  { id: 'text',      label: 'Text Annotation  — 1 click'     },
]

const HINTS = {
  hline:     ['Click to place horizontal line'],
  vline:     ['Click to place vertical line'],
  trendline: ['Click 1st point', 'Click 2nd point  ·  Esc to cancel'],
  channel:   ['Click 1st point (top line)', 'Click 2nd point (top line)', 'Click a point on the lower parallel  ·  Esc'],
  long:      ['Click entry price', 'Click target price  ·  Esc to cancel'],
  short:     ['Click entry price', 'Click target price  ·  Esc to cancel'],
  text:      ['Click to place text'],
}

export default function DrawingOverlay({ chartApiRef, chartVersion, children }) {
  const wrapRef  = useRef(null)
  const [drawings,  setDrawings]  = useState([])
  const [tool,      setTool]      = useState('cursor')
  const [color,     setColor]     = useState(COLORS[0])
  const [clicks,    setClicks]    = useState([])   // pending click chain for multi-point tools
  const [hover,     setHover]     = useState(null) // { x, y } for live preview
  const [textPos,   setTextPos]   = useState(null)
  const [textVal,   setTextVal]   = useState('')
  const [tick,      setTick]      = useState(0)    // forced rerender on chart scroll

  // Subscribe to chart scroll/zoom → redraw SVG
  useEffect(() => {
    const api = chartApiRef.current
    if (!api?.chart) return
    const fn = () => setTick(t => t + 1)
    try {
      api.chart.timeScale().subscribeVisibleLogicalRangeChange(fn)
      return () => api.chart.timeScale().unsubscribeVisibleLogicalRangeChange(fn)
    } catch {}
  }, [chartVersion]) // eslint-disable-line

  // Escape → cancel
  useEffect(() => {
    const h = e => {
      if (e.key === 'Escape') { setClicks([]); setTool('cursor'); setTextPos(null) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ── Coordinate helpers ───────────────────────────────────────────────────
  const wrapCoords = e => {
    const r = wrapRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const toData = ({ x, y }) => {
    const api = chartApiRef.current
    if (!api) return null
    try {
      const time  = api.chart.timeScale().coordinateToTime(x)
      const price = api.mainSeries.coordinateToPrice(y)
      if (time == null || price == null) return null
      return { time, price }
    } catch { return null }
  }

  const toPx = ({ time, price }) => {
    const api = chartApiRef.current
    if (!api) return null
    try {
      const x = api.chart.timeScale().timeToCoordinate(time)
      const y = api.mainSeries.priceToCoordinate(price)
      if (x == null || y == null) return null
      return { x, y }
    } catch { return null }
  }

  // Width for line extensions (use container width or large fallback)
  const W = wrapRef.current?.clientWidth || 2000

  // ── Event handlers ────────────────────────────────────────────────────────
  const handleClick = e => {
    if (tool === 'cursor') return
    const xy    = wrapCoords(e)
    const data  = toData(xy)
    if (!data) return

    if (tool === 'text') {
      setTextPos({ ...data, ...xy }); setTextVal(''); return
    }

    const maxClicks = { hline: 1, vline: 1, trendline: 2, channel: 3, long: 2, short: 2 }[tool] ?? 1
    const next = [...clicks, { ...xy, ...data }]

    if (next.length < maxClicks) {
      setClicks(next)
    } else {
      // All points gathered → create drawing
      addDrawing(next)
      setClicks([])
      setTool('cursor')
    }
  }

  const handleMove = e => setHover(wrapCoords(e))
  const handleLeave = () => setHover(null)

  const addDrawing = pts => {
    const d = { id: Date.now() + Math.random(), color }
    switch (tool) {
      case 'hline':    setDrawings(p=>[...p, { ...d, type:'hline',    price: pts[0].price }]); break
      case 'vline':    setDrawings(p=>[...p, { ...d, type:'vline',    time:  pts[0].time  }]); break
      case 'trendline':setDrawings(p=>[...p, { ...d, type:'trendline',p1: pts[0], p2: pts[1] }]); break
      case 'channel':  setDrawings(p=>[...p, { ...d, type:'channel',  p1: pts[0], p2: pts[1], p3: pts[2] }]); break
      case 'long':     setDrawings(p=>[...p, { ...d, type:'long',  entry: pts[0].price, exit: pts[1].price, time: pts[0].time }]); break
      case 'short':    setDrawings(p=>[...p, { ...d, type:'short', entry: pts[0].price, exit: pts[1].price, time: pts[0].time }]); break
    }
  }

  const del = id => setDrawings(p => p.filter(d => d.id !== id))

  // ── Delete button (pointer-events always on) ─────────────────────────────
  const DelBtn = ({ x, y, id }) => (
    <g style={{ pointerEvents:'all', cursor:'pointer' }}
       onClick={e => { e.stopPropagation(); del(id) }}>
      <circle cx={x} cy={y} r={8} fill="white" stroke="#d1d5db" strokeWidth={1}/>
      <text x={x} y={y+4} textAnchor="middle" fill="#6b7280"
        fontSize={12} fontWeight="bold" style={{userSelect:'none',pointerEvents:'none'}}>×</text>
    </g>
  )

  // ── Render saved drawings ────────────────────────────────────────────────
  const renderSaved = d => {
    switch (d.type) {

      case 'hline': {
        const api = chartApiRef.current
        const py  = (() => { try { return api?.mainSeries.priceToCoordinate(d.price) } catch { return null } })()
        if (py == null) return null
        const lbl = d.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })
        return <g key={d.id} style={{pointerEvents:'none'}}>
          <line x1={0} y1={py} x2="100%" y2={py} stroke={d.color} strokeWidth={1.5}/>
          <rect x={W - 66} y={py - 10} width={58} height={19} rx={3} fill={d.color}/>
          <text x={W - 37} y={py + 5} textAnchor="middle" fill="white"
            fontSize={10} style={{userSelect:'none'}}>{lbl}</text>
          <DelBtn x={W - 76} y={py} id={d.id}/>
        </g>
      }

      case 'vline': {
        const api = chartApiRef.current
        const px  = (() => { try { return api?.chart.timeScale().timeToCoordinate(d.time) } catch { return null } })()
        if (px == null) return null
        return <g key={d.id} style={{pointerEvents:'none'}}>
          <line x1={px} y1={0} x2={px} y2="100%" stroke={d.color} strokeWidth={1.5} strokeDasharray="5 4"/>
          <DelBtn x={px} y={14} id={d.id}/>
        </g>
      }

      case 'trendline': {
        const pp1 = toPx(d.p1), pp2 = toPx(d.p2)
        if (!pp1 || !pp2) return null
        const [ex1, ey1, ex2, ey2] = extendLine(pp1.x, pp1.y, pp2.x, pp2.y, W)
        return <g key={d.id} style={{pointerEvents:'none'}}>
          <line x1={ex1} y1={ey1} x2={ex2} y2={ey2} stroke={d.color} strokeWidth={1.5}/>
          <circle cx={pp1.x} cy={pp1.y} r={4} fill={d.color}/>
          <circle cx={pp2.x} cy={pp2.y} r={4} fill={d.color}/>
          <DelBtn x={(pp1.x+pp2.x)/2} y={(pp1.y+pp2.y)/2} id={d.id}/>
        </g>
      }

      case 'channel': {
        const pp1 = toPx(d.p1), pp2 = toPx(d.p2), pp3 = toPx(d.p3)
        if (!pp1 || !pp2 || !pp3) return null
        // Main line
        const [ax1, ay1, ax2, ay2] = extendLine(pp1.x, pp1.y, pp2.x, pp2.y, W)
        // Parallel line through p3 (same slope, offset by p3's distance from main line)
        const slope = Math.abs(pp2.x - pp1.x) > 0.5 ? (pp2.y - pp1.y) / (pp2.x - pp1.x) : null
        // Perpendicular offset
        const dy = slope != null
          ? pp3.y - (pp1.y + slope * (pp3.x - pp1.x))   // vertical offset (approx)
          : pp3.x - pp1.x
        const [bx1, by1, bx2, by2] = [ax1, ay1 + dy, ax2, ay2 + dy]
        return <g key={d.id} style={{pointerEvents:'none'}}>
          <polygon points={`${ax1},${ay1} ${ax2},${ay2} ${bx2},${by2} ${bx1},${by1}`}
            fill={d.color} opacity={0.08}/>
          <line x1={ax1} y1={ay1} x2={ax2} y2={ay2} stroke={d.color} strokeWidth={1.5}/>
          <line x1={bx1} y1={by1} x2={bx2} y2={by2} stroke={d.color} strokeWidth={1.5} strokeDasharray="4 3"/>
          <circle cx={pp1.x} cy={pp1.y} r={4} fill={d.color}/>
          <circle cx={pp2.x} cy={pp2.y} r={4} fill={d.color}/>
          <DelBtn x={(pp1.x+pp2.x)/2} y={(pp1.y+pp2.y)/2 - dy/2} id={d.id}/>
        </g>
      }

      case 'long':
      case 'short': {
        const ep = toPx({ time: d.time, price: d.entry })
        const xp = toPx({ time: d.time, price: d.exit  })
        if (!ep || !xp) return null
        const isLong = d.type === 'long'
        const fill   = isLong ? '#16a34a' : '#dc2626'
        const y1 = Math.min(ep.y, xp.y), y2 = Math.max(ep.y, xp.y)
        const bx = 30, bw = W - 70
        return <g key={d.id} style={{pointerEvents:'none'}}>
          <rect x={bx} y={y1} width={bw} height={Math.max(y2-y1,1)} fill={fill} opacity={0.15} rx={2}/>
          <line x1={0} y1={ep.y} x2="100%" y2={ep.y} stroke={fill} strokeWidth={1.5}/>
          <line x1={0} y1={xp.y} x2="100%" y2={xp.y} stroke={fill} strokeWidth={1.5} strokeDasharray="4 3"/>
          <rect x={bx} y={ep.y - 10} width={74} height={19} rx={3} fill={fill} opacity={0.9}/>
          <text x={bx+37} y={ep.y+5} textAnchor="middle" fill="white"
            fontSize={10} style={{userSelect:'none'}}>{isLong ? '▲ Entry' : '▼ Entry'}</text>
          <DelBtn x={bx+bw+12} y={(y1+y2)/2} id={d.id}/>
        </g>
      }

      case 'text': {
        const p = toPx(d)
        if (!p) return null
        return <g key={d.id} style={{pointerEvents:'none'}}>
          <text x={p.x} y={p.y} fill={d.color} fontSize={13} fontWeight={500}
            style={{userSelect:'none'}}>{d.text}</text>
          <DelBtn x={p.x + (d.text?.length ?? 0) * 7 + 12} y={p.y - 8} id={d.id}/>
        </g>
      }

      default: return null
    }
  }

  // ── Live preview ─────────────────────────────────────────────────────────
  const renderPreview = () => {
    if (!hover) return null
    const { x, y } = hover
    const dash = '5 4'

    if (tool === 'hline')
      return <line x1={0} y1={y} x2="100%" y2={y} stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.6}/>

    if (tool === 'vline')
      return <line x1={x} y1={0} x2={x} y2="100%" stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.6}/>

    if (tool === 'trendline' && clicks.length === 1) {
      const [ex1,ey1,ex2,ey2] = extendLine(clicks[0].x, clicks[0].y, x, y, W)
      return <g>
        <line x1={ex1} y1={ey1} x2={ex2} y2={ey2} stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.6}/>
        <circle cx={clicks[0].x} cy={clicks[0].y} r={4} fill={color}/>
      </g>
    }

    if (tool === 'channel' && clicks.length === 2) {
      const [ax1,ay1,ax2,ay2] = extendLine(clicks[0].x, clicks[0].y, clicks[1].x, clicks[1].y, W)
      const slope = Math.abs(clicks[1].x - clicks[0].x) > 0.5
        ? (clicks[1].y - clicks[0].y) / (clicks[1].x - clicks[0].x) : null
      const dy = slope != null ? y - (clicks[0].y + slope * (x - clicks[0].x)) : y - clicks[0].y
      return <g>
        <line x1={ax1} y1={ay1} x2={ax2} y2={ay2} stroke={color} strokeWidth={1.5}/>
        <line x1={ax1} y1={ay1+dy} x2={ax2} y2={ay2+dy} stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.6}/>
      </g>
    }

    if (tool === 'channel' && clicks.length === 1) {
      const [ex1,ey1,ex2,ey2] = extendLine(clicks[0].x, clicks[0].y, x, y, W)
      return <line x1={ex1} y1={ey1} x2={ex2} y2={ey2} stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.6}/>
    }

    if ((tool === 'long' || tool === 'short') && clicks.length === 1) {
      const fill = tool === 'long' ? '#16a34a' : '#dc2626'
      const y1 = Math.min(clicks[0].y, y), y2 = Math.max(clicks[0].y, y)
      return <g>
        <line x1={0} y1={clicks[0].y} x2="100%" y2={clicks[0].y} stroke={fill} strokeWidth={1.5}/>
        <rect x={30} y={y1} width={W-70} height={Math.max(y2-y1,1)} fill={fill} opacity={0.12} rx={2}/>
        <line x1={0} y1={y} x2="100%" y2={y} stroke={fill} strokeWidth={1.5} strokeDasharray={dash} opacity={0.7}/>
      </g>
    }

    return null
  }

  const isDrawing = tool !== 'cursor'
  const hintStep  = isDrawing ? (HINTS[tool]?.[clicks.length] ?? '') : ''

  return (
    <div ref={wrapRef} className="relative w-full h-full">
      {children}

      {/* SVG overlay — z-index:1000 above lw-charts canvas */}
      <svg
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          zIndex: 1000,
          pointerEvents: 'none',    // default: transparent — chart pans normally
          overflow: 'visible',
        }}
      >
        {/* Saved drawings (pointer-events: none; delete buttons override) */}
        {drawings.map(renderSaved)}

        {/* Live preview */}
        <g style={{pointerEvents:'none'}}>
          {renderPreview()}
          {/* Pending click dots */}
          {clicks.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={4} fill={color} opacity={0.85}/>)}
        </g>

        {/* Capture rect — only when drawing active; pointer-events: all */}
        {isDrawing && (
          <rect
            x={0} y={0} width="100%" height="100%"
            fill="transparent"
            style={{ cursor: 'crosshair', pointerEvents: 'all' }}
            onClick={handleClick}
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
          />
        )}
      </svg>

      {/* Floating toolbar */}
      <div style={{ position:'absolute', top:8, left:8, zIndex:1001 }}
        className="flex items-center gap-0.5 bg-white/96 backdrop-blur border border-gray-200 rounded-xl shadow-md px-1.5 py-1.5">
        {TOOLS.map((t, i) => {
          if (t === null) return <div key={i} className="w-px h-5 bg-gray-200 mx-0.5"/>
          const { id, label } = t
          const active = tool === id
          return (
            <button key={id} title={label}
              onClick={() => { setTool(active ? 'cursor' : id); setClicks([]) }}
              style={{ padding:'6px', borderRadius:'8px', background: active ? '#7c3aed' : 'transparent',
                       color: active ? 'white' : '#6b7280', border:'none', cursor:'pointer',
                       transition:'all 0.15s', display:'flex', alignItems:'center', justifyContent:'center' }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background='#f3f4f6' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background='transparent' }}
            >
              <ToolIcon id={id} size={16} color={active ? 'white' : '#6b7280'}/>
            </button>
          )
        })}

        {/* Colour swatches */}
        <div className="w-px h-5 bg-gray-200 mx-0.5"/>
        {COLORS.map(c => (
          <button key={c} title={c}
            onClick={() => setColor(c)}
            style={{ width:14, height:14, borderRadius:'50%', background:c, border:'none',
                     cursor:'pointer', margin:'0 2px',
                     outline: color === c ? '2px solid #7c3aed' : '2px solid transparent',
                     outlineOffset:'2px',
                     transform: color === c ? 'scale(1.25)' : 'scale(1)',
                     transition:'all 0.15s' }}
          />
        ))}

        <div className="w-px h-5 bg-gray-200 mx-0.5"/>
        <button title="Clear all drawings"
          onClick={() => { setDrawings([]); setClicks([]) }}
          style={{ padding:'6px', borderRadius:'8px', background:'transparent', color:'#9ca3af',
                   border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}
          onMouseEnter={e => { e.currentTarget.style.background='#fef2f2'; e.currentTarget.style.color='#ef4444' }}
          onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='#9ca3af' }}
        >
          <Trash2 size={14}/>
        </button>
      </div>

      {/* Hint bar */}
      {isDrawing && hintStep && (
        <div style={{ position:'absolute', bottom:12, left:'50%', transform:'translateX(-50%)',
          zIndex:1001, pointerEvents:'none', background:'rgba(0,0,0,0.72)', color:'white',
          fontSize:12, padding:'6px 14px', borderRadius:20, whiteSpace:'nowrap' }}>
          {hintStep}
        </div>
      )}

      {/* Text input */}
      {textPos && (
        <div style={{ position:'absolute', left: Math.min(textPos.x+4, (wrapRef.current?.clientWidth||800)-220),
          top: textPos.y - 22, zIndex:1002,
          background:'white', border:'1px solid #8b5cf6', borderRadius:8, boxShadow:'0 4px 16px rgba(0,0,0,0.15)' }}>
          <input autoFocus value={textVal} onChange={e=>setTextVal(e.target.value)}
            onKeyDown={e=>{
              if (e.key==='Enter' && textVal.trim()) {
                setDrawings(p=>[...p, { id:Date.now(), type:'text', color,
                  time:textPos.time, price:textPos.price, text:textVal.trim() }])
                setTextPos(null); setTextVal(''); setTool('cursor')
              }
              if (e.key==='Escape') { setTextPos(null); setTextVal('') }
            }}
            placeholder="Type text, then Enter"
            style={{ padding:'6px 12px', fontSize:13, outline:'none', width:210,
                     color:'#1f2937', borderRadius:8, border:'none', background:'transparent' }}
          />
        </div>
      )}
    </div>
  )
}
