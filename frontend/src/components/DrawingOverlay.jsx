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
 *  - Anchors store canonical epoch seconds (`t`), NOT bar indices, so one set
 *    of drawings per SYMBOL renders on every timeframe: a trend line drawn on
 *    the daily chart appears in the same place on the 1h/15m/5m charts. Times
 *    are mapped to the active chart's bars at render time (with interpolation
 *    between bars and extrapolation past the loaded history).
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Trash2 } from 'lucide-react'

// ─── Preset colours ────────────────────────────────────────────────────────
const COLORS = ['#e11d48', '#2196F3', '#16a34a', '#d97706', '#374151']

const uid = () => Date.now() + Math.random()
const px  = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by)

// ─── Defensive hydration ────────────────────────────────────────────────────
// localStorage may hold legacy-format or partially-written drawings (the draw
// tools were rebuilt, so old entries have a different schema). A single bad
// entry must NOT crash the app, so we validate every drawing and drop anything
// malformed. A point is anchored by `t` (epoch seconds — current, timeframe-
// independent), `logical` (bar index — legacy, per-timeframe) or `time` + price.
const isNum   = v => typeof v === 'number' && isFinite(v)
const hasTime = p => isNum(p.t) || isNum(p.logical) || (p.time !== null && p.time !== undefined)
const validPt = p => p && typeof p === 'object' && isNum(p.price) && hasTime(p)
const hasAnchor = d => isNum(d.t) || isNum(d.logical) || (d.time !== null && d.time !== undefined)

// Chart bar time → epoch seconds. Daily+ bars carry "YYYY-MM-DD" strings,
// intraday bars carry unix seconds already.
const timeToEpoch = time =>
  typeof time === 'number' ? time : Date.parse(`${time}T00:00:00Z`) / 1000

function sanitizeDrawings(raw) {
  if (!Array.isArray(raw)) return []
  return raw.filter(d => {
    if (!d || typeof d !== 'object' || !d.type) return false
    switch (d.type) {
      case 'trendline':
      case 'long':
      case 'short':   return validPt(d.p1) && validPt(d.p2)
      case 'channel': return validPt(d.p1) && validPt(d.p2) && validPt(d.p3)
      case 'hline':   return isNum(d.price)
      case 'vline':   return hasAnchor(d)
      case 'text':    return hasAnchor(d) && isNum(d.price) && typeof d.text === 'string'
      default:        return false
    }
  })
}

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

export default function DrawingOverlay({ chartApiRef, chartVersion, storageKey, migrateKey, children }) {
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

  // ── Persistence (localStorage, per SYMBOL — drawings show on all timeframes) ─
  const keyRef       = useRef(storageKey)
  const hydratingRef = useRef(true)

  // Load saved drawings whenever the chart's symbol changes
  useEffect(() => {
    hydratingRef.current = true
    keyRef.current = storageKey
    setSelectedId(null); setPending(null); setDraft(null); setClicks([])
    if (!storageKey) { setDrawings([]); hydratingRef.current = false; return }
    try {
      const raw = localStorage.getItem(STORE_PREFIX + storageKey)
      setDrawings(sanitizeDrawings(raw ? JSON.parse(raw) : []))
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
  // ── Pane top-offset helpers (DOM-based, exact) ────────────────────────────
  // lightweight-charts v5: coordinateToPrice / priceToCoordinate use PANE-LOCAL
  // Y coordinates (0 = top of that pane), NOT full-chart Y. The SVG overlay
  // works in full-chart Y, so we must add/subtract each pane's top offset.
  // We read offsets from the actual canvas elements — the most reliable source.
  const getPaneTops = useCallback(() => {
    const el = wrapRef.current
    if (!el) return [0]
    const containerTop = el.getBoundingClientRect().top
    const seen = new Set()
    const tops = []
    el.querySelectorAll('canvas').forEach(c => {
      const t = Math.round(c.getBoundingClientRect().top - containerTop)
      if (t >= 0 && !seen.has(t)) { seen.add(t); tops.push(t) }
    })
    tops.sort((a, b) => a - b)
    return tops.length ? tops : [0]
  }, [])

  // Which pane does a full-chart y pixel fall in? Returns { paneIdx, paneTop }.
  const getPaneAt = useCallback((y) => {
    const tops = getPaneTops()
    for (let i = tops.length - 1; i >= 0; i--) {
      if (y >= tops[i]) return { paneIdx: i, paneTop: tops[i] }
    }
    return { paneIdx: 0, paneTop: 0 }
  }, [getPaneTops])

  // Series to use for coordinate conversion for each pane index.
  const seriesForPane = useCallback((paneIdx) => {
    const api = chartApiRef.current
    if (!api) return null
    return ([api.mainSeries, api.macdSeries, api.ratioSeries])[paneIdx] || api.mainSeries
  }, []) // eslint-disable-line

  // Re-render drawings whenever time range OR any pane's Y scale changes.
  useEffect(() => {
    const api = chartApiRef.current
    if (!api?.chart || !api?.mainSeries) return
    let raf = 0
    let lastSig = ''
    const tick = () => {
      try {
        const r   = api.chart.timeScale().getVisibleLogicalRange()
        // Sample pane-local y=50 for each pane — changes when scale autoscales
        const v0  = api.mainSeries.coordinateToPrice(50) ?? 0
        const v1  = api.macdSeries?.coordinateToPrice(50) ?? 0
        const v2  = api.ratioSeries?.coordinateToPrice(50) ?? 0
        // Also include pane tops so separator drags trigger re-render
        const tops = getPaneTops().join(',')
        const sig = `${r ? `${r.from.toFixed(3)}:${r.to.toFixed(3)}` : 'x'}|${v0}|${v1}|${v2}|${tops}`
        if (sig !== lastSig) { lastSig = sig; force(n => n + 1) }
      } catch { /* chart mid-teardown */ }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [chartVersion, getPaneTops]) // eslint-disable-line

  // ── Time anchoring: epoch seconds ↔ bar position on the ACTIVE chart ──────
  // Drawings store epoch times so they carry across timeframes. Each chart maps
  // them to (fractional) logical bar indices: binary-search the candle times,
  // interpolate between bars, extrapolate past the ends by the median bar
  // duration. Cached per candle array (rebuilt when the chart data changes).
  const epochsRef = useRef({ candles: null, arr: [], barSec: 86400 })
  const getEpochs = useCallback(() => {
    const candles = chartApiRef.current?.candles
    if (!candles?.length) return null
    if (epochsRef.current.candles !== candles) {
      const arr = candles.map(c => timeToEpoch(c.time))
      const diffs = []
      for (let i = 1; i < arr.length; i++) diffs.push(arr[i] - arr[i - 1])
      diffs.sort((a, b) => a - b)
      const barSec = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 86400
      epochsRef.current = { candles, arr, barSec }
    }
    return epochsRef.current
  }, []) // eslint-disable-line

  const epochToLogical = useCallback((t) => {
    const e = getEpochs()
    if (!e || !isNum(t)) return null
    const { arr, barSec } = e
    const n = arr.length
    if (t <= arr[0])     return (t - arr[0]) / barSec
    if (t >= arr[n - 1]) return (n - 1) + (t - arr[n - 1]) / barSec
    let lo = 0, hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (arr[mid] <= t) lo = mid; else hi = mid
    }
    const span = arr[hi] - arr[lo]
    return lo + (span > 0 ? (t - arr[lo]) / span : 0)
  }, [getEpochs])

  const logicalToEpoch = useCallback((logical) => {
    const e = getEpochs()
    if (!e || !isNum(logical)) return null
    const { arr, barSec } = e
    const n = arr.length
    if (logical <= 0)     return arr[0] + logical * barSec
    if (logical >= n - 1) return arr[n - 1] + (logical - (n - 1)) * barSec
    const lo = Math.floor(logical)
    return arr[lo] + (logical - lo) * (arr[lo + 1] - arr[lo])
  }, [getEpochs])

  // One-time migration of the old per-timeframe store. Legacy drawings are
  // anchored by bar index, which only means something on the timeframe they
  // were drawn on — so each legacy set is converted exactly when ITS chart is
  // up (candles present), then folded into the per-symbol store and removed.
  // (Must live BELOW the anchoring helpers — the deps array reads them at
  // render time, before any effect runs.)
  useEffect(() => {
    if (!migrateKey || migrateKey === storageKey) return
    if (!chartApiRef.current?.candles?.length) return
    const legacyRaw = localStorage.getItem(STORE_PREFIX + migrateKey)
    if (legacyRaw == null) return
    let legacy
    try { legacy = sanitizeDrawings(JSON.parse(legacyRaw)) } catch { legacy = [] }
    localStorage.removeItem(STORE_PREFIX + migrateKey)
    if (!legacy.length) return

    const anchorT = p => isNum(p.t) ? p.t
      : isNum(p.logical) ? logicalToEpoch(p.logical)
      : p.time != null ? timeToEpoch(p.time) : null
    const upPt = p => ({ t: anchorT(p), price: p.price, pane: p.pane ?? 0 })
    const upgraded = legacy.map(d => {
      switch (d.type) {
        case 'trendline':
        case 'long':
        case 'short':   return { ...d, p1: upPt(d.p1), p2: upPt(d.p2) }
        case 'channel': return { ...d, p1: upPt(d.p1), p2: upPt(d.p2), p3: upPt(d.p3) }
        case 'vline':
        case 'text':    return { ...d, t: anchorT(d), logical: undefined, time: undefined }
        default:        return d   // hline — already timeframe-free
      }
    })

    setDrawings(prev => {
      const merged = [...prev, ...upgraded]
      // Persist directly — the debounced persist effect may still be gated by
      // the hydration flag when the chart comes up.
      try { localStorage.setItem(STORE_PREFIX + keyRef.current, JSON.stringify(merged)) } catch { /* ignore */ }
      return merged
    })
  }, [chartVersion, migrateKey, storageKey, logicalToEpoch]) // eslint-disable-line

  // ── Coordinate helpers ───────────────────────────────────────────────────
  const wrapCoords = useCallback(e => {
    const r = wrapRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }, [])

  // Convert full-chart {x,y} → {t, logical, price, pane}. `t` (epoch seconds)
  // is the canonical anchor that survives timeframe switches; `logical` is kept
  // for same-frame pixel math during the gesture.
  // Subtracts the pane's top offset so we pass pane-local Y to coordinateToPrice.
  const toData = useCallback(({ x, y }) => {
    const api = chartApiRef.current
    if (!api) return null
    try {
      const logical = api.chart.timeScale().coordinateToLogical(x)
      if (logical == null) return null
      const { paneIdx, paneTop } = getPaneAt(y)
      const series  = seriesForPane(paneIdx)
      const price   = series?.coordinateToPrice(y - paneTop)   // pane-local Y
      if (price == null) return null
      return { t: logicalToEpoch(logical), logical, price, pane: paneIdx }
    } catch { return null }
  }, [getPaneAt, seriesForPane, logicalToEpoch]) // eslint-disable-line

  // X pixel for a point/drawing anchored by `t` (current), `logical` or `time`
  // (both legacy, valid only on the timeframe they were drawn on).
  const anchorToX = useCallback((pt) => {
    const api = chartApiRef.current
    if (!api) return null
    try {
      if (isNum(pt.t)) {
        const logical = epochToLogical(pt.t)
        return logical != null ? api.chart.timeScale().logicalToCoordinate(logical) : null
      }
      if (isNum(pt.logical)) return api.chart.timeScale().logicalToCoordinate(pt.logical)
      if (pt.time != null)   return api.chart.timeScale().timeToCoordinate(pt.time)
      return null
    } catch { return null }
  }, [epochToLogical]) // eslint-disable-line

  // Convert {t | logical | time, price, pane} → full-chart {x,y}.
  // Adds the pane's top offset to the pane-local Y from priceToCoordinate.
  const toPx = useCallback((pt) => {
    const api = chartApiRef.current
    if (!api || !pt) return null
    const { price, pane = 0 } = pt
    try {
      const x = anchorToX(pt)
      const series   = seriesForPane(pane)
      const paneLocalY = series?.priceToCoordinate(price)       // pane-local Y
      if (x == null || paneLocalY == null) return null
      const tops     = getPaneTops()
      const paneTop  = tops[pane] ?? 0
      return { x, y: paneLocalY + paneTop }                     // → full-chart Y
    } catch { return null }
  }, [seriesForPane, getPaneTops, anchorToX]) // eslint-disable-line

  // priceY for hlines — pane-aware: convert on that pane's own series scale and
  // offset by the pane top. pane 0 (main) keeps the original fast path.
  const priceY = (p, pane = 0) => {
    try {
      if (!pane) return chartApiRef.current?.mainSeries.priceToCoordinate(p)
      const y = seriesForPane(pane)?.priceToCoordinate(p)
      if (y == null) return null
      return y + (getPaneTops()[pane] ?? 0)
    } catch { return null }
  }
  const logicalAtX = x => { try { return chartApiRef.current?.chart.timeScale().coordinateToLogical(x) } catch { return null } }

  // Resolve a logical index to the time of the nearest candle. Candle indices
  // map 1:1 to logical indices; a fractional/out-of-range logical snaps to the
  // closest bar (matches TradingView's vertical-line date snapping).
  const timeAtLogical = (logical) => {
    const candles = chartApiRef.current?.candles
    if (!candles?.length || logical == null || !isFinite(logical)) return null
    const idx = Math.max(0, Math.min(candles.length - 1, Math.round(logical)))
    return candles[idx]?.time ?? null
  }

  // Format a candle time for the vertical-line tag. Daily+ timeframes carry a
  // "YYYY-MM-DD" string → "24 Jun 2026"; intraday carries a unix-seconds number
  // → "24 Jun, 14:30".
  const fmtDateLabel = (time) => {
    if (time == null) return null
    if (typeof time === 'string') {
      const d = new Date(`${time}T00:00:00`)
      return isNaN(d) ? time : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    }
    const d = new Date(time * 1000)
    return isNaN(d) ? null : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const W = wrapRef.current?.clientWidth  || 2000
  const H = wrapRef.current?.clientHeight || 500

  // ── Build a shape from two data points ─────────────────────────────────────
  // Anchors persist `t` (epoch) so the shape renders on every timeframe.
  const makeTwoPoint = (t, a, b) => {
    const base = { id: uid(), color: colorRef.current }
    const pt = (p) => ({ t: p.t ?? logicalToEpoch(p.logical), price: p.price, pane: p.pane ?? 0 })
    if (t === 'trendline')
      return { ...base, type: 'trendline', p1: pt(a), p2: pt(b) }
    if (t === 'long' || t === 'short')
      return { ...base, type: t, p1: pt(a), p2: pt(b) }
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
      case 'hline':     return { price: { x: 0, y: priceY(d.price, d.pane) } }
      case 'vline':     return { time:  { x: anchorToX(d), y: 0 } }
      case 'long':
      case 'short':     return { p1: toPx(d.p1), p2: toPx(d.p2) }
      case 'text':      return { pos: toPx(d) }
      default:          return {}
    }
  }

  // ── Apply a single-handle drag ─────────────────────────────────────────────
  // Edited anchors are re-written in canonical `t` form (legacy `logical`/`time`
  // fields are dropped, upgrading old drawings the first time they're touched).
  const applyHandle = (id, handle, data) => setDrawings(prev => prev.map(d => {
    if (d.id !== id) return d
    switch (d.type) {
      case 'trendline':
      case 'channel':
      case 'long':
      case 'short':     return { ...d, [handle]: { t: data.t, price: data.price, pane: data.pane ?? d[handle]?.pane ?? 0 } }
      case 'hline':     return { ...d, price: data.price, pane: data.pane ?? d.pane ?? 0 }
      case 'vline':     return { ...d, t: data.t, logical: undefined, time: undefined }
      case 'text':      return { ...d, t: data.t, logical: undefined, time: undefined, price: data.price, pane: data.pane ?? d.pane ?? 0 }
      default:          return d
    }
  }))

  // ── Apply a body drag (translate every anchor by the pixel delta) ──────────
  const applyBody = (a, xy) => {
    const dx = xy.x - a.start.x, dy = xy.y - a.start.y
    const nd = k => {
      const p = toData({ x: a.anchors[k].x + dx, y: a.anchors[k].y + dy })
      return p ? { t: p.t, price: p.price, pane: p.pane ?? 0 } : null
    }
    setDrawings(prev => prev.map(d => {
      if (d.id !== a.id) return d
      switch (d.type) {
        case 'trendline': { const p1 = nd('p1'), p2 = nd('p2'); return (p1 && p2) ? { ...d, p1, p2 } : d }
        case 'channel':   { const p1 = nd('p1'), p2 = nd('p2'), p3 = nd('p3'); return (p1 && p2 && p3) ? { ...d, p1, p2, p3 } : d }
        case 'hline':     { const p = nd('price'); return p ? { ...d, price: p.price, pane: p.pane ?? d.pane ?? 0 } : d }
        case 'vline':     { const p = nd('time');  return p ? { ...d, t: p.t, logical: undefined, time: undefined } : d }
        case 'long':
        case 'short':     { const p1 = nd('p1'), p2 = nd('p2'); return (p1 && p2) ? { ...d, p1, p2 } : d }
        case 'text':      { const p = nd('pos'); return p ? { ...d, t: p.t, logical: undefined, time: undefined, price: p.price } : d }
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

    if (t === 'text') { setTextPos({ ...xy, t: data.t, price: data.price, pane: data.pane ?? 0 }); setTextVal(''); return }

    if (t === 'hline') {
      addDrawing({ id: uid(), type: 'hline', price: data.price, pane: data.pane ?? 0, color: colorRef.current })
      setTool('cursor'); return
    }
    if (t === 'vline') {
      addDrawing({ id: uid(), type: 'vline', t: data.t, color: colorRef.current })
      setTool('cursor'); return
    }

    if (t === 'channel') {
      const next = [...clicks, { ...xy, ...data }]
      if (next.length < 3) { setClicks(next) }
      else {
        const cp = (p) => ({ t: p.t, price: p.price, pane: p.pane ?? 0 })
        addDrawing({ id: uid(), type: 'channel', color: colorRef.current,
          p1: cp(next[0]), p2: cp(next[1]), p3: cp(next[2]) })
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

  // Date/time tag pinned to the bottom (time-axis) of a vertical line — mirrors
  // TradingView's vertical-line date indicator. Clamped to stay on-screen.
  const DateTag = ({ x, label, color }) => {
    if (!label || x == null) return null
    const boxW = label.length * 6 + 14
    const cx   = Math.max(boxW / 2, Math.min(W - boxW / 2, x))
    const yTop = H - 21
    return (
      <g style={{ pointerEvents: 'none' }}>
        <rect x={cx - boxW / 2} y={yTop} width={boxW} height={17} rx={3} fill={color} />
        <text x={cx} y={yTop + 12.5} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={600}
          style={{ userSelect: 'none' }}>{label}</text>
      </g>
    )
  }

  const hoverProps = id => interactive
    ? { onPointerEnter: () => setHoverId(id), onPointerLeave: () => setHoverId(null) }
    : {}

  // ── Render a saved drawing (visible + interactive layers) ──────────────────
  const renderSaved = d => {
    const show    = interactive && (selectedId === d.id || hoverId === d.id)
    const showDel = interactive && hoverId === d.id   // delete × only while hovering

    switch (d.type) {
      case 'hline': {
        const y = priceY(d.price, d.pane); if (y == null) return null
        // Indicator-pane values (ratio ≈ 0.0098, MACD ≈ -0.04) round to "0.00"
        // at 2dp — widen the precision for sub-1 magnitudes so the tag is real.
        const lbl = d.price.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(d.price) < 1 ? 5 : 2 })
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
        const x = anchorToX(d); if (x == null) return null
        const label = fmtDateLabel(
          isNum(d.t) ? timeAtLogical(epochToLogical(d.t))
                     : d.logical != null ? timeAtLogical(d.logical) : d.time)
        return (
          <g key={d.id} {...hoverProps(d.id)}>
            <line x1={x} y1={0} x2={x} y2="100%" stroke={d.color} strokeWidth={1.5} strokeDasharray="5 4" style={{ pointerEvents: 'none' }}/>
            {interactive &&
              <line x1={x} y1={0} x2={x} y2="100%" stroke="transparent" strokeWidth={12}
                style={{ pointerEvents: 'stroke', cursor: 'ew-resize' }} onPointerDown={e => onBodyDown(e, d.id)} />}
            {show && <DateTag x={x} label={label} color={d.color}/>}
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
        const p = toPx(d); if (!p) return null
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
    if (tool === 'vline') return (
      <g>
        <line x1={x} y1={0} x2={x} y2="100%" stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.6}/>
        <DateTag x={x} label={fmtDateLabel(timeAtLogical(logicalAtX(x)))} color={color}/>
      </g>
    )

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
        {drawings.map(d => { try { return renderSaved(d) } catch { return null } })}

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
                addDrawing({ id: uid(), type: 'text', color, t: textPos.t, price: textPos.price, pane: textPos.pane ?? 0, text: textVal.trim() })
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
