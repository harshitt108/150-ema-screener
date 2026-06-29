/**
 * DrawingOverlay — interactive, editable drawing tools on top of CandleChart.
 *
 * Designed to feel like TradingView:
 *  - Trendline / position tools: click-and-DRAG to draw in one gesture
 *    (click-then-click also works as a fallback).
 *  - Every shape is EDITABLE after drawing: drag an endpoint handle to reshape,
 *    or drag the body to move the whole shape. Handles appear on hover/select.
 *  - Delete a selected shape with Delete/Backspace, or the × button.
 *  - Shapes are anchored in DATA coordinates (time/price) so they stick to the
 *    candles when you pan/zoom.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Trash2 } from 'lucide-react'

// ─── Preset colours ────────────────────────────────────────────────────────
const COLORS = ['#e11d48', '#2196F3', '#16a34a', '#d97706', '#374151']

const uid = () => Date.now() + Math.random()
const px  = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by)

// ─── Inline SVG icons for each tool (16×16) ─────────────────────────────────
const ToolIcon = ({ id, size = 16, color = 'currentColor' }) => {
  const s = size
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
  { id: 'cursor',    label: 'Cursor — select & move drawings' },
  null,
  { id: 'trendline', label: 'Trend Line — click-drag (or 2 clicks)' },
  { id: 'hline',     label: 'Horizontal Line — click' },
  { id: 'vline',     label: 'Vertical Line — click' },
  { id: 'channel',   label: 'Parallel Channel — 3 clicks' },
  null,
  { id: 'long',      label: 'Long Position — click-drag (or 2 clicks)' },
  { id: 'short',     label: 'Short Position — click-drag (or 2 clicks)' },
  null,
  { id: 'text',      label: 'Text — click to place' },
]

// One-line guidance shown while a tool is active
const HINTS = {
  trendline: 'Click and drag to draw a trend line — or click two points',
  hline:     'Click to place a horizontal line',
  vline:     'Click to place a vertical line',
  channel:   ['Click the 1st point', 'Click the 2nd point', 'Click to set channel width'],
  long:      'Drag a box from entry to target — shows % gain',
  short:     'Drag a box from entry to target — shows % gain',
  text:      'Click to place text',
}

const STORE_PREFIX = 'chartDrawings:'

export default function DrawingOverlay({ chartApiRef, chartVersion, storageKey, children }) {
  const wrapRef = useRef(null)
  const [drawings,   setDrawings]   = useState([])
  const [tool,       setTool]       = useState('cursor')
  const [color,      setColor]      = useState(COLORS[0])
  const [selectedId, setSelectedId] = useState(null)
  const [hoverId,    setHoverId]    = useState(null)

  // Creation state
  const [draft,   setDraft]   = useState(null)  // live drag while drawing { tool, p1, cur }
  const [pending, setPending] = useState(null)  // first click waiting for second { x,y,time,price }
  const [clicks,  setClicks]  = useState([])    // click-based chain (channel)
  const [hover,   setHover]   = useState(null)  // pointer {x,y} for previews
  const [textPos, setTextPos] = useState(null)
  const [textVal, setTextVal] = useState('')
  const [, force]             = useState(0)     // redraw on chart pan/zoom

  const actionRef = useRef(null)   // active drag gesture
  const colorRef  = useRef(color)
  const toolRef   = useRef(tool)
  colorRef.current = color
  toolRef.current  = tool

  // ── Persistence (localStorage, per symbol+timeframe) ───────────────────────
  const keyRef       = useRef(storageKey)
  const hydratingRef = useRef(true)

  // Load saved drawings whenever the chart's symbol/timeframe changes
  useEffect(() => {
    hydratingRef.current = true
    keyRef.current = storageKey
    setSelectedId(null); setPending(null); setDraft(null); setClicks([])
    if (!storageKey) { setDrawings([]); hydratingRef.current = false; return }
    try {
      const raw = localStorage.getItem(STORE_PREFIX + storageKey)
      setDrawings(raw ? JSON.parse(raw) : [])
    } catch { setDrawings([]) }
    // Re-enable persistence only after the loaded state has committed
    const id = requestAnimationFrame(() => { hydratingRef.current = false })
    return () => cancelAnimationFrame(id)
  }, [storageKey])

  // Persist on every change (skip the render caused by loading)
  useEffect(() => {
    if (hydratingRef.current || !keyRef.current) return
    try {
      if (drawings.length) localStorage.setItem(STORE_PREFIX + keyRef.current, JSON.stringify(drawings))
      else                 localStorage.removeItem(STORE_PREFIX + keyRef.current)
    } catch { /* quota / disabled storage — ignore */ }
  }, [drawings])

  // Keep drawings glued to the candles. lightweight-charts' time-scale event
  // only fires on horizontal pan/zoom — NOT on vertical price-axis rescale or
  // autoscale — so anchored shapes would detach when the price scale changes.
  // Instead we poll the projection each frame and re-render only when either the
  // horizontal range OR the vertical price→pixel mapping actually changes (idle
  // frames do a cheap compare and bail, so there's no wasted rendering).
  useEffect(() => {
    const api = chartApiRef.current
    if (!api?.chart || !api?.mainSeries) return
    let raf = 0
    let lastSig = ''
    const tick = () => {
      try {
        const r = api.chart.timeScale().getVisibleLogicalRange()
        // coordinateToPrice at a fixed pixel changes iff the vertical scale moved
        const vy = api.mainSeries.coordinateToPrice(100)
        const sig = `${r ? `${r.from.toFixed(3)}:${r.to.toFixed(3)}` : 'x'}|${vy}`
        if (sig !== lastSig) { lastSig = sig; force(n => n + 1) }
      } catch { /* chart mid-teardown — ignore */ }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [chartVersion]) // eslint-disable-line

  // ── Coordinate helpers ───────────────────────────────────────────────────
  const wrapCoords = useCallback(e => {
    const r = wrapRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }, [])

  // Anchor shapes by LOGICAL bar index (not time). coordinateToTime() returns
  // null for any pixel past the last candle, so a trendline endpoint dragged
  // into the whitespace on the right would freeze and channels would snap around
  // near the latest bar. logicalToCoordinate() extrapolates across the whole
  // chart width (incl. whitespace), so shapes can be drawn/extended anywhere.
  const toData = useCallback(({ x, y }) => {
    const api = chartApiRef.current
    if (!api) return null
    try {
      const logical = api.chart.timeScale().coordinateToLogical(x)
      const price   = api.mainSeries.coordinateToPrice(y)
      if (logical == null || price == null) return null
      return { logical, price }
    } catch { return null }
  }, []) // eslint-disable-line

  const toPx = useCallback(({ logical, price, time }) => {
    const api = chartApiRef.current
    if (!api) return null
    try {
      let x = logical != null ? api.chart.timeScale().logicalToCoordinate(logical) : null
      // Back-compat: render older drawings that were saved with a `time` anchor
      if (x == null && time != null) x = api.chart.timeScale().timeToCoordinate(time)
      const y = api.mainSeries.priceToCoordinate(price)
      if (x == null || y == null) return null
      return { x, y }
    } catch { return null }
  }, []) // eslint-disable-line

  const priceY   = p => { try { return chartApiRef.current?.mainSeries.priceToCoordinate(p) } catch { return null } }
  const logicalX = l => { try { return chartApiRef.current?.chart.timeScale().logicalToCoordinate(l) } catch { return null } }
  const timeX    = t => { try { return chartApiRef.current?.chart.timeScale().timeToCoordinate(t) } catch { return null } }

  const W = wrapRef.current?.clientWidth || 2000

  // ── Build a shape from two data points ─────────────────────────────────────
  const makeTwoPoint = (t, a, b) => {
    const base = { id: uid(), color: colorRef.current }
    if (t === 'trendline')
      return { ...base, type: 'trendline', p1: { logical: a.logical, price: a.price }, p2: { logical: b.logical, price: b.price } }
    if (t === 'long' || t === 'short')
      return { ...base, type: t, p1: { logical: a.logical, price: a.price }, p2: { logical: b.logical, price: b.price } }
    return null
  }

  // Signed % move from entry (p1) to target (p2), oriented for P/L direction
  const posPct = (p1, p2, isLong) => {
    if (!p1?.price) return 0
    const raw = (p2.price - p1.price) / p1.price * 100
    return isLong ? raw : -raw
  }
  const fmtPct = v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

  const addDrawing = d => { setDrawings(p => [...p, d]); setSelectedId(d.id) }
  const del        = id => { setDrawings(p => p.filter(d => d.id !== id)); setSelectedId(s => s === id ? null : s) }

  // ── Anchors of a shape in pixels (for body-drag translation) ───────────────
  const anchorsPx = d => {
    switch (d.type) {
      case 'trendline': return { p1: toPx(d.p1), p2: toPx(d.p2) }
      case 'channel':   return { p1: toPx(d.p1), p2: toPx(d.p2), p3: toPx(d.p3) }
      case 'hline':     return { price: { x: 0, y: priceY(d.price) } }
      case 'vline':     return { time:  { x: d.logical != null ? logicalX(d.logical) : timeX(d.time), y: 0 } }
      case 'long':
      case 'short':     return { p1: toPx(d.p1), p2: toPx(d.p2) }
      case 'text':      return { pos: toPx({ logical: d.logical, time: d.time, price: d.price }) }
      default:          return {}
    }
  }

  // ── Apply a single-handle drag ─────────────────────────────────────────────
  const applyHandle = (id, handle, data) => setDrawings(prev => prev.map(d => {
    if (d.id !== id) return d
    switch (d.type) {
      case 'trendline':
      case 'channel':
      case 'long':
      case 'short':     return { ...d, [handle]: { logical: data.logical, price: data.price } }
      case 'hline':     return { ...d, price: data.price }
      case 'vline':     return { ...d, logical: data.logical }
      case 'text':      return { ...d, logical: data.logical, price: data.price }
      default:          return d
    }
  }))

  // ── Apply a body drag (translate every anchor by the pixel delta) ──────────
  const applyBody = (a, xy) => {
    const dx = xy.x - a.start.x, dy = xy.y - a.start.y
    const nd = k => toData({ x: a.anchors[k].x + dx, y: a.anchors[k].y + dy })
    setDrawings(prev => prev.map(d => {
      if (d.id !== a.id) return d
      switch (d.type) {
        case 'trendline': { const p1 = nd('p1'), p2 = nd('p2'); return (p1 && p2) ? { ...d, p1, p2 } : d }
        case 'channel':   { const p1 = nd('p1'), p2 = nd('p2'), p3 = nd('p3'); return (p1 && p2 && p3) ? { ...d, p1, p2, p3 } : d }
        case 'hline':     { const p = nd('price'); return p ? { ...d, price: p.price } : d }
        case 'vline':     { const p = nd('time');  return p ? { ...d, logical: p.logical } : d }
        case 'long':
        case 'short':     { const p1 = nd('p1'), p2 = nd('p2'); return (p1 && p2) ? { ...d, p1, p2 } : d }
        case 'text':      { const p = nd('pos'); return p ? { ...d, logical: p.logical, price: p.price } : d }
        default:          return d
      }
    }))
  }

  // ── Window-level drag tracking ─────────────────────────────────────────────
  // The actual logic lives in refs (always latest); the window listeners are
  // STABLE wrappers, so add/removeEventListener always use identical references.
  const moveLogic = useRef(() => {})
  const upLogic   = useRef(() => {})

  moveLogic.current = e => {
    const a = actionRef.current
    if (!a) return
    const xy = wrapCoords(e)
    if (a.kind === 'draw') {
      const data = toData(xy)
      setDraft(d => d ? { ...d, cur: { ...xy, ...(data || {}) } } : d)
    } else if (a.kind === 'handle') {
      const data = toData(xy)
      if (data) applyHandle(a.id, a.handle, data)
    } else if (a.kind === 'body') {
      applyBody(a, xy)
    }
  }

  upLogic.current = e => {
    const a = actionRef.current
    actionRef.current = null
    window.removeEventListener('pointermove', stableMove)
    window.removeEventListener('pointerup', stableUp)
    if (!a) return
    if (a.kind === 'draw') {
      const xy = wrapCoords(e)
      const data = toData(xy)
      const moved = px(a.p1.x, a.p1.y, xy.x, xy.y) > 5
      if (moved && data) {
        const d = makeTwoPoint(a.tool, a.p1, data)
        if (d) addDrawing(d)
        setDraft(null); setTool('cursor')
      } else {
        // treated as a click → wait for a second click to complete
        setPending({ ...a.p1 }); setDraft(null)
      }
    }
  }

  const stableMove = useCallback(e => moveLogic.current(e), [])
  const stableUp   = useCallback(e => upLogic.current(e), [])

  const startAction = (action) => {
    actionRef.current = action
    window.addEventListener('pointermove', stableMove)
    window.addEventListener('pointerup', stableUp)
  }

  // Safety: drop any stray listeners on unmount
  useEffect(() => () => {
    window.removeEventListener('pointermove', stableMove)
    window.removeEventListener('pointerup', stableUp)
  }, [stableMove, stableUp])

  // ── Capture-surface handlers (drawing mode) ────────────────────────────────
  const onSurfaceDown = e => {
    const t = toolRef.current
    if (t === 'cursor') return
    const xy = wrapCoords(e)
    const data = toData(xy)
    if (!data) return

    if (t === 'text') { setTextPos({ ...data, ...xy }); setTextVal(''); return }

    if (t === 'hline') {
      addDrawing({ id: uid(), type: 'hline', price: data.price, color: colorRef.current })
      setTool('cursor'); return
    }
    if (t === 'vline') {
      addDrawing({ id: uid(), type: 'vline', logical: data.logical, color: colorRef.current })
      setTool('cursor'); return
    }

    if (t === 'channel') {
      const next = [...clicks, { ...xy, ...data }]
      if (next.length < 3) { setClicks(next) }
      else {
        addDrawing({ id: uid(), type: 'channel', color: colorRef.current,
          p1: { logical: next[0].logical, price: next[0].price },
          p2: { logical: next[1].logical, price: next[1].price },
          p3: { logical: next[2].logical, price: next[2].price } })
        setClicks([]); setTool('cursor')
      }
      return
    }

    // two-point drag-or-click tools (trendline, long, short)
    if (pending) {
      const d = makeTwoPoint(t, pending, data)
      if (d) addDrawing(d)
      setPending(null); setTool('cursor'); return
    }
    setDraft({ tool: t, p1: { ...xy, ...data }, cur: { ...xy, ...data } })
    startAction({ kind: 'draw', tool: t, p1: { ...xy, ...data } })
  }

  const onSurfaceMove = e => setHover(wrapCoords(e))
  const onSurfaceLeave = () => setHover(null)

  // ── Edit gestures (cursor mode) ────────────────────────────────────────────
  const onHandleDown = (e, id, handle) => {
    e.stopPropagation(); e.preventDefault()
    setSelectedId(id)
    startAction({ kind: 'handle', id, handle })
  }
  const onBodyDown = (e, id) => {
    e.stopPropagation(); e.preventDefault()
    setSelectedId(id)
    const dr = drawings.find(d => d.id === id)
    if (!dr) return
    startAction({ kind: 'body', id, anchors: anchorsPx(dr), start: wrapCoords(e) })
  }

  // ── Keyboard: Esc cancels, Delete removes selection ────────────────────────
  useEffect(() => {
    const h = e => {
      if (e.key === 'Escape') {
        setClicks([]); setPending(null); setDraft(null); setTool('cursor'); setTextPos(null); setSelectedId(null)
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId != null && !textPos) {
        e.preventDefault(); del(selectedId)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selectedId, textPos]) // eslint-disable-line

  // Reset transient creation state whenever the tool changes
  useEffect(() => { setClicks([]); setPending(null); setDraft(null) }, [tool])

  // ─────────────────────────────────────────────────────────────────────────
  // Small reusable bits
  const interactive = tool === 'cursor'

  const Handle = ({ x, y, id, handle, cursor = 'grab' }) => (
    <circle cx={x} cy={y} r={6} fill="#fff" stroke="#7c3aed" strokeWidth={2}
      style={{ pointerEvents: 'all', cursor }}
      onPointerDown={e => onHandleDown(e, id, handle)} />
  )

  const DelBtn = ({ x, y, id }) => (
    <g style={{ pointerEvents: 'all', cursor: 'pointer' }}
       onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}
       onClick={e => { e.stopPropagation(); del(id) }}>
      <circle cx={x} cy={y} r={9} fill="#fff" stroke="#ef4444" strokeWidth={1.25}/>
      <path d={`M${x-3.5} ${y-3.5} L${x+3.5} ${y+3.5} M${x+3.5} ${y-3.5} L${x-3.5} ${y+3.5}`}
        stroke="#ef4444" strokeWidth={1.5} strokeLinecap="round" style={{ pointerEvents: 'none' }}/>
    </g>
  )

  const hoverProps = id => interactive
    ? { onPointerEnter: () => setHoverId(id), onPointerLeave: () => setHoverId(null) }
    : {}

  // ── Render a saved drawing (visible + interactive layers) ──────────────────
  const renderSaved = d => {
    const show    = interactive && (selectedId === d.id || hoverId === d.id)
    const showDel = interactive && hoverId === d.id   // delete × only while hovering

    switch (d.type) {
      case 'hline': {
        const y = priceY(d.price); if (y == null) return null
        const lbl = d.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })
        return (
          <g key={d.id} {...hoverProps(d.id)}>
            <line x1={0} y1={y} x2="100%" y2={y} stroke={d.color} strokeWidth={1.5} style={{ pointerEvents: 'none' }}/>
            {interactive &&
              <line x1={0} y1={y} x2="100%" y2={y} stroke="transparent" strokeWidth={12}
                style={{ pointerEvents: 'stroke', cursor: 'ns-resize' }} onPointerDown={e => onBodyDown(e, d.id)} />}
            <rect x={W - 66} y={y - 10} width={58} height={19} rx={3} fill={d.color} style={{ pointerEvents: 'none' }}/>
            <text x={W - 37} y={y + 5} textAnchor="middle" fill="#fff" fontSize={10} style={{ pointerEvents: 'none', userSelect: 'none' }}>{lbl}</text>
            {show && <Handle x={70} y={y} id={d.id} handle="price" cursor="ns-resize"/>}
            {showDel && <DelBtn x={W - 84} y={y} id={d.id}/>}
          </g>
        )
      }

      case 'vline': {
        const x = d.logical != null ? logicalX(d.logical) : timeX(d.time); if (x == null) return null
        return (
          <g key={d.id} {...hoverProps(d.id)}>
            <line x1={x} y1={0} x2={x} y2="100%" stroke={d.color} strokeWidth={1.5} strokeDasharray="5 4" style={{ pointerEvents: 'none' }}/>
            {interactive &&
              <line x1={x} y1={0} x2={x} y2="100%" stroke="transparent" strokeWidth={12}
                style={{ pointerEvents: 'stroke', cursor: 'ew-resize' }} onPointerDown={e => onBodyDown(e, d.id)} />}
            {show && <Handle x={x} y={40} id={d.id} handle="time" cursor="ew-resize"/>}
            {showDel && <DelBtn x={x} y={16} id={d.id}/>}
          </g>
        )
      }

      case 'trendline': {
        const a = toPx(d.p1), b = toPx(d.p2); if (!a || !b) return null
        return (
          <g key={d.id} {...hoverProps(d.id)}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={d.color} strokeWidth={show ? 2 : 1.5} style={{ pointerEvents: 'none' }}/>
            {interactive &&
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14}
                style={{ pointerEvents: 'stroke', cursor: 'move' }} onPointerDown={e => onBodyDown(e, d.id)} />}
            {show && <>
              <Handle x={a.x} y={a.y} id={d.id} handle="p1"/>
              <Handle x={b.x} y={b.y} id={d.id} handle="p2"/>
            </>}
            {showDel && <DelBtn x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 16} id={d.id}/>}
          </g>
        )
      }

      case 'channel': {
        const p1 = toPx(d.p1), p2 = toPx(d.p2), p3 = toPx(d.p3); if (!p1 || !p2 || !p3) return null
        // Finite channel: rails span ONLY between the two anchor points (p1→p2),
        // not the whole chart width. The user controls the length by where the
        // points are placed. dy = vertical offset of the parallel rail (set by p3).
        const slope = Math.abs(p2.x - p1.x) > 0.5 ? (p2.y - p1.y) / (p2.x - p1.x) : null
        const dy = slope != null ? p3.y - (p1.y + slope * (p3.x - p1.x)) : p3.y - p1.y
        return (
          <g key={d.id} {...hoverProps(d.id)}>
            <polygon points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p2.x},${p2.y + dy} ${p1.x},${p1.y + dy}`} fill={d.color} opacity={0.08} style={{ pointerEvents: 'none' }}/>
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={d.color} strokeWidth={1.5} style={{ pointerEvents: 'none' }}/>
            <line x1={p1.x} y1={p1.y + dy} x2={p2.x} y2={p2.y + dy} stroke={d.color} strokeWidth={1.5} strokeDasharray="4 3" style={{ pointerEvents: 'none' }}/>
            {interactive &&
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={14}
                style={{ pointerEvents: 'stroke', cursor: 'move' }} onPointerDown={e => onBodyDown(e, d.id)} />}
            {show && <>
              <Handle x={p1.x} y={p1.y} id={d.id} handle="p1"/>
              <Handle x={p2.x} y={p2.y} id={d.id} handle="p2"/>
              <Handle x={p3.x} y={p3.y} id={d.id} handle="p3"/>
            </>}
            {showDel && <DelBtn x={(p1.x + p2.x) / 2} y={(p1.y + p2.y) / 2 - 16} id={d.id}/>}
          </g>
        )
      }

      case 'long':
      case 'short': {
        const a = toPx(d.p1), b = toPx(d.p2)   // a = entry corner, b = target corner
        if (!a || !b) return null
        const isLong = d.type === 'long'
        const fill = isLong ? '#16a34a' : '#dc2626'
        const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x)
        const top  = Math.min(a.y, b.y), bot   = Math.max(a.y, b.y)
        const w = Math.max(right - left, 1), h = Math.max(bot - top, 1)
        const lbl = fmtPct(posPct(d.p1, d.p2, isLong))
        const lblX = Math.max(left + 2, right - 52)
        return (
          <g key={d.id} {...hoverProps(d.id)}>
            <rect x={left} y={top} width={w} height={h} fill={fill} opacity={0.13} stroke={fill} strokeOpacity={0.5} rx={2} style={{ pointerEvents: 'none' }}/>
            <line x1={left} y1={a.y} x2={right} y2={a.y} stroke={fill} strokeWidth={1.5} style={{ pointerEvents: 'none' }}/>
            <line x1={left} y1={b.y} x2={right} y2={b.y} stroke={fill} strokeWidth={1.5} strokeDasharray="4 3" style={{ pointerEvents: 'none' }}/>
            <rect x={lblX} y={b.y - 9} width={50} height={18} rx={3} fill={fill} style={{ pointerEvents: 'none' }}/>
            <text x={lblX + 25} y={b.y + 4} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={600} style={{ pointerEvents: 'none', userSelect: 'none' }}>{lbl}</text>
            {interactive &&
              <rect x={left} y={top} width={w} height={h} fill="transparent"
                style={{ pointerEvents: 'all', cursor: 'move' }} onPointerDown={e => onBodyDown(e, d.id)} />}
            {show && <>
              <Handle x={a.x} y={a.y} id={d.id} handle="p1"/>
              <Handle x={b.x} y={b.y} id={d.id} handle="p2"/>
            </>}
            {showDel && <DelBtn x={right + 4} y={top} id={d.id}/>}
          </g>
        )
      }

      case 'text': {
        const p = toPx({ logical: d.logical, time: d.time, price: d.price }); if (!p) return null
        const wpx = (d.text?.length ?? 0) * 7 + 8
        return (
          <g key={d.id} {...hoverProps(d.id)}>
            <text x={p.x} y={p.y} fill={d.color} fontSize={13} fontWeight={500} style={{ pointerEvents: 'none', userSelect: 'none' }}>{d.text}</text>
            {interactive &&
              <rect x={p.x - 2} y={p.y - 14} width={wpx} height={20} fill="transparent"
                style={{ pointerEvents: 'all', cursor: 'move' }} onPointerDown={e => onBodyDown(e, d.id)} />}
            {showDel && <DelBtn x={p.x + wpx} y={p.y - 8} id={d.id}/>}
          </g>
        )
      }

      default: return null
    }
  }

  // Shared box-style preview for the long/short position tool
  const positionPreview = (t, p1, cur, pct) => {
    const fill = t === 'long' ? '#16a34a' : '#dc2626'
    const left = Math.min(p1.x, cur.x), right = Math.max(p1.x, cur.x)
    const top  = Math.min(p1.y, cur.y), bot   = Math.max(p1.y, cur.y)
    return (
      <g>
        <rect x={left} y={top} width={Math.max(right - left, 1)} height={Math.max(bot - top, 1)} fill={fill} opacity={0.12} stroke={fill} strokeOpacity={0.5} rx={2}/>
        <line x1={left} y1={p1.y}  x2={right} y2={p1.y}  stroke={fill} strokeWidth={1.5}/>
        <line x1={left} y1={cur.y} x2={right} y2={cur.y} stroke={fill} strokeWidth={1.5} strokeDasharray="5 4"/>
        {pct != null &&
          <text x={right - 4} y={cur.y - 5} textAnchor="end" fill={fill} fontSize={11} fontWeight={700}>{fmtPct(pct)}</text>}
      </g>
    )
  }

  // ── Live preview while creating ────────────────────────────────────────────
  const renderPreview = () => {
    const dash = '5 4'
    // dragging a trend/position
    if (draft) {
      const { tool: t, p1, cur } = draft
      if (t === 'trendline')
        return <g><line x1={p1.x} y1={p1.y} x2={cur.x} y2={cur.y} stroke={color} strokeWidth={1.5} strokeDasharray={dash}/><circle cx={p1.x} cy={p1.y} r={4} fill={color}/><circle cx={cur.x} cy={cur.y} r={4} fill={color}/></g>
      if (t === 'long' || t === 'short') {
        const pct = (p1.price != null && cur.price != null) ? posPct(p1, cur, t === 'long') : null
        return positionPreview(t, p1, cur, pct)
      }
    }
    if (!hover) return null
    const { x, y } = hover

    // first point placed (click mode), rubber-band to cursor
    if (pending) {
      if (tool === 'trendline')
        return <g><line x1={pending.x} y1={pending.y} x2={x} y2={y} stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.7}/><circle cx={pending.x} cy={pending.y} r={4} fill={color}/></g>
      if (tool === 'long' || tool === 'short') {
        const cd = toData({ x, y })
        const pct = (pending.price != null && cd) ? posPct(pending, cd, tool === 'long') : null
        return positionPreview(tool, pending, { x, y }, pct)
      }
    }

    // crosshair-style placement previews
    if (tool === 'hline') return <line x1={0} y1={y} x2="100%" y2={y} stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.6}/>
    if (tool === 'vline') return <line x1={x} y1={0} x2={x} y2="100%" stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.6}/>

    // channel click chain
    if (tool === 'channel' && clicks.length === 1)
      return <line x1={clicks[0].x} y1={clicks[0].y} x2={x} y2={y} stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.6}/>
    if (tool === 'channel' && clicks.length === 2) {
      const c0 = clicks[0], c1 = clicks[1]
      const slope = Math.abs(c1.x - c0.x) > 0.5 ? (c1.y - c0.y) / (c1.x - c0.x) : null
      const dy = slope != null ? y - (c0.y + slope * (x - c0.x)) : y - c0.y
      return <g><line x1={c0.x} y1={c0.y} x2={c1.x} y2={c1.y} stroke={color} strokeWidth={1.5}/><line x1={c0.x} y1={c0.y + dy} x2={c1.x} y2={c1.y + dy} stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.6}/></g>
    }
    return null
  }

  const isDrawing = tool !== 'cursor'
  const rawHint   = HINTS[tool]
  const hintText  = Array.isArray(rawHint) ? rawHint[clicks.length] : rawHint

  return (
    <div ref={wrapRef} className="relative w-full h-full">
      {children}

      {/* SVG overlay — sits above the lightweight-charts canvas */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1000, pointerEvents: 'none', overflow: 'visible' }}>
        {drawings.map(renderSaved)}

        <g style={{ pointerEvents: 'none' }}>
          {renderPreview()}
          {clicks.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={4} fill={color} opacity={0.85}/>)}
        </g>

        {/* Capture surface — only while a draw tool is active (chart pans freely otherwise) */}
        {isDrawing && (
          <rect x={0} y={0} width="100%" height="100%" fill="transparent"
            style={{ cursor: 'crosshair', pointerEvents: 'all' }}
            onPointerDown={onSurfaceDown} onPointerMove={onSurfaceMove} onPointerLeave={onSurfaceLeave}/>
        )}
      </svg>

      {/* Floating toolbar */}
      <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 1001 }}
        className="flex items-center gap-0.5 bg-white/96 backdrop-blur border border-gray-200 rounded-xl shadow-md px-1.5 py-1.5">
        {TOOLS.map((t, i) => {
          if (t === null) return <div key={i} className="w-px h-5 bg-gray-200 mx-0.5"/>
          const { id, label } = t
          const active = tool === id
          return (
            <button key={id} title={label}
              onClick={() => { setTool(active ? 'cursor' : id); setClicks([]); setPending(null) }}
              style={{ padding: '6px', borderRadius: '8px', background: active ? '#7c3aed' : 'transparent',
                       color: active ? 'white' : '#6b7280', border: 'none', cursor: 'pointer',
                       transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f3f4f6' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
              <ToolIcon id={id} size={16} color={active ? 'white' : '#6b7280'}/>
            </button>
          )
        })}

        {/* Colour swatches */}
        <div className="w-px h-5 bg-gray-200 mx-0.5"/>
        {COLORS.map(c => (
          <button key={c} title={c} onClick={() => setColor(c)}
            style={{ width: 14, height: 14, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', margin: '0 2px',
                     outline: color === c ? '2px solid #7c3aed' : '2px solid transparent', outlineOffset: '2px',
                     transform: color === c ? 'scale(1.25)' : 'scale(1)', transition: 'all 0.15s' }}/>
        ))}

        <div className="w-px h-5 bg-gray-200 mx-0.5"/>
        <button title="Clear all drawings"
          onClick={() => { setDrawings([]); setClicks([]); setPending(null); setSelectedId(null) }}
          style={{ padding: '6px', borderRadius: '8px', background: 'transparent', color: '#9ca3af', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#ef4444' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af' }}>
          <Trash2 size={14}/>
        </button>
      </div>

      {/* Hint bar */}
      {isDrawing && hintText && (
        <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1001, pointerEvents: 'none',
          background: 'rgba(0,0,0,0.72)', color: 'white', fontSize: 12, padding: '6px 14px', borderRadius: 20, whiteSpace: 'nowrap' }}>
          {hintText}
        </div>
      )}

      {/* Text input */}
      {textPos && (
        <div style={{ position: 'absolute', left: Math.min(textPos.x + 4, (wrapRef.current?.clientWidth || 800) - 220), top: textPos.y - 22, zIndex: 1002,
          background: 'white', border: '1px solid #8b5cf6', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
          <input autoFocus value={textVal} onChange={e => setTextVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && textVal.trim()) {
                addDrawing({ id: uid(), type: 'text', color, logical: textPos.logical, price: textPos.price, text: textVal.trim() })
                setTextPos(null); setTextVal(''); setTool('cursor')
              }
              if (e.key === 'Escape') { setTextPos(null); setTextVal('') }
            }}
            placeholder="Type text, then Enter"
            style={{ padding: '6px 12px', fontSize: 13, outline: 'none', width: 210, color: '#1f2937', borderRadius: 8, border: 'none', background: 'transparent' }}/>
        </div>
      )}
    </div>
  )
}
