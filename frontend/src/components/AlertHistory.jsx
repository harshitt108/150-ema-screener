import { useState, useMemo, useRef, useEffect } from 'react'
import { TrendingUp, TrendingDown, ChevronDown, Bell, CheckCircle2, Zap } from 'lucide-react'

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseAlert(a) {
  const at = a.alertType
  if (at === 'golden_cross') return {
    isBull: true, isEmaEma: true, emaLevel: null,
    description: 'Golden Cross — 20 EMA crossed above 50 EMA',
    badge: 'GOLDEN', type: 'Bullish Signal',
  }
  if (at === 'death_cross') return {
    isBull: false, isEmaEma: true, emaLevel: null,
    description: 'Death Cross — 20 EMA crossed below 50 EMA',
    badge: 'DEATH', type: 'Bearish Signal',
  }
  const parts = at.split('_')
  const isBull = parts[1] === 'above'
  const level  = parts[2] || ''
  return {
    isBull, isEmaEma: false, emaLevel: level,
    description: `Crossed ${isBull ? 'above' : 'below'} the ${level} EMA`,
    badge: null, type: isBull ? 'Bullish Signal' : 'Bearish Signal',
  }
}

function getStatus(a, parsed, tableStatus) {
  const st = tableStatus?.[a.symbol]?.ema
  if (!st) return null
  if (parsed.isEmaEma) {
    const e20 = tableStatus[a.symbol]?.ema?.['20']?.value
    const e50 = tableStatus[a.symbol]?.ema?.['50']?.value
    if (e20 == null || e50 == null) return null
    return parsed.isBull ? (e20 > e50) : (e20 < e50)
  }
  const emaEntry = st[parsed.emaLevel]
  if (!emaEntry) return null
  return parsed.isBull ? emaEntry.above : !emaEntry.above
}

function formatDateFull(dateStr) {
  // dateStr is "YYYY-MM-DD"
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function formatTime(isoStr) {
  try {
    const IST = 5.5 * 60 * 60 * 1000
    return new Date(new Date(isoStr).getTime() + IST)
      .toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  } catch { return '' }
}

// ─── Animated accordion panel ────────────────────────────────────────────────
function AccordionPanel({ open, children }) {
  const ref = useRef(null)
  const [height, setHeight] = useState(open ? 'auto' : '0px')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open) {
      const h = el.scrollHeight
      setHeight(h + 'px')
      // after transition, switch to auto so it can reflow naturally
      const id = setTimeout(() => setHeight('auto'), 310)
      return () => clearTimeout(id)
    } else {
      // lock current height first so transition fires
      setHeight(ref.current.scrollHeight + 'px')
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHeight('0px'))
      })
    }
  }, [open])

  return (
    <div
      ref={ref}
      style={{
        height,
        overflow: 'hidden',
        transition: 'height 0.3s ease-out',
      }}
    >
      {children}
    </div>
  )
}

// ─── Single alert card ───────────────────────────────────────────────────────
function AlertCard({ alert, parsed, active, index }) {
  const [hovered, setHovered] = useState(false)
  const isBull = parsed.isBull

  const borderColor = isBull
    ? (active === false ? '#059669' : '#10B981')
    : (active === false ? '#b91c1c' : '#EF4444')

  const bgColor = isBull
    ? (active === false ? 'rgba(16,185,129,0.05)' : 'rgba(16,185,129,0.08)')
    : (active === false ? 'rgba(239,68,68,0.05)'  : 'rgba(239,68,68,0.08)')

  const shadowHover = isBull
    ? '0 4px 20px rgba(16,185,129,0.12)'
    : '0 4px 20px rgba(239,68,68,0.12)'

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderLeft: `3px solid ${borderColor}`,
        background: bgColor,
        borderRadius: '8px',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '12px',
        transition: 'box-shadow 0.2s ease, background 0.2s ease',
        boxShadow: hovered ? shadowHover : 'none',
        animation: `slideIn 0.25s ease-out ${index * 40}ms both`,
        cursor: 'default',
      }}
    >
      {/* Left section */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0, flex: 1 }}>
        {/* Direction icon */}
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isBull ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
        }}>
          {isBull
            ? <TrendingUp size={16} color="#10B981" />
            : <TrendingDown size={16} color="#EF4444" />}
        </div>

        {/* Text block */}
        <div style={{ minWidth: 0 }}>
          {/* Row 1: symbol + EMA badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: '#F1F5F9', letterSpacing: '-0.01em' }}>
              {alert.symbol}
            </span>
            {parsed.emaLevel && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                background: isBull ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
                color: isBull ? '#6EE7B7' : '#FCA5A5',
                letterSpacing: '0.04em',
              }}>
                {parsed.emaLevel} EMA
              </span>
            )}
            {parsed.badge && (
              <span style={{
                fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 4,
                background: isBull ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)',
                color: isBull ? '#34D399' : '#F87171',
                letterSpacing: '0.06em',
              }}>
                {parsed.badge}
              </span>
            )}
          </div>

          {/* Row 2: description */}
          <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 3, fontWeight: 400 }}>
            {parsed.description}
          </p>

          {/* Row 3: tertiary — visible on hover */}
          <div style={{
            marginTop: 6,
            display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
            maxHeight: hovered ? '40px' : '0px',
            overflow: 'hidden',
            transition: 'max-height 0.2s ease-out, opacity 0.2s ease-out',
            opacity: hovered ? 1 : 0,
          }}>
            <span style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>
              {parsed.type}
            </span>
            {formatTime(alert.triggeredAt) && (
              <span style={{ fontSize: 11, color: '#475569' }}>
                · Detected at {formatTime(alert.triggeredAt)} IST
              </span>
            )}
            {active !== null && (
              <span style={{ fontSize: 11, color: '#475569' }}>
                · {active ? 'Signal still in effect' : 'Price has since recovered'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right section */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
        {/* Price */}
        {alert.currentPrice != null && (
          <span style={{ fontSize: 15, fontWeight: 700, color: '#E2E8F0', fontVariantNumeric: 'tabular-nums' }}>
            ₹{alert.currentPrice.toLocaleString('en-IN')}
          </span>
        )}

        {/* % from EMA */}
        {alert.distancePct != null && (
          <span style={{
            fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
            color: isBull ? '#34D399' : '#F87171',
          }}>
            {alert.distancePct >= 0 ? '+' : ''}{alert.distancePct.toFixed(1)}%
          </span>
        )}

        {/* Status badge */}
        {active === true && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
            background: 'rgba(249,115,22,0.15)', color: '#FB923C',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{ fontSize: 8 }}>●</span> Active
          </span>
        )}
        {active === false && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
            background: 'rgba(16,185,129,0.12)', color: '#34D399',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <CheckCircle2 size={11} /> Recovered
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Date section (accordion) ────────────────────────────────────────────────
function DateSection({ dateStr, alerts, tableStatus, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)

  const parsed  = alerts.map(a => parseAlert(a))
  const statuses = alerts.map((a, i) => getStatus(a, parsed[i], tableStatus))

  const activeCount    = statuses.filter(s => s === true).length
  const recoveredCount = statuses.filter(s => s === false).length
  const bullCount      = parsed.filter(p => p.isBull).length
  const bearCount      = parsed.filter(p => !p.isBull).length

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Date header / accordion trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px',
          background: open ? 'rgba(124,58,237,0.06)' : 'rgba(255,255,255,0.02)',
          border: `1px solid ${open ? 'rgba(124,58,237,0.2)' : '#1e1e30'}`,
          borderRadius: 12,
          cursor: 'pointer',
          transition: 'background 0.2s ease, border-color 0.2s ease',
          textAlign: 'left',
        }}
        onMouseEnter={e => {
          if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
        }}
        onMouseLeave={e => {
          if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
        }}
      >
        {/* Left: date + stats */}
        <div>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#F1F5F9', letterSpacing: '-0.01em', margin: 0 }}>
            {formatDateFull(dateStr)}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#64748B' }}>
              {alerts.length} signal{alerts.length !== 1 ? 's' : ''}
            </span>
            {bullCount > 0 && (
              <span style={{ fontSize: 11, color: '#34D399', display: 'flex', alignItems: 'center', gap: 3 }}>
                <TrendingUp size={10} /> {bullCount} bullish
              </span>
            )}
            {bearCount > 0 && (
              <span style={{ fontSize: 11, color: '#F87171', display: 'flex', alignItems: 'center', gap: 3 }}>
                <TrendingDown size={10} /> {bearCount} bearish
              </span>
            )}
            {activeCount > 0 && (
              <span style={{ fontSize: 11, color: '#FB923C' }}>
                ● {activeCount} active
              </span>
            )}
            {recoveredCount > 0 && (
              <span style={{ fontSize: 11, color: '#6EE7B7' }}>
                ✓ {recoveredCount} recovered
              </span>
            )}
          </div>
        </div>
        {/* Chevron */}
        <ChevronDown
          size={18}
          color="#475569"
          style={{ transition: 'transform 0.3s ease-out', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
        />
      </button>

      {/* Expandable cards */}
      <AccordionPanel open={open}>
        <div style={{ paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.map((a, i) => (
            <AlertCard
              key={a.id}
              alert={a}
              parsed={parsed[i]}
              active={statuses[i]}
              index={i}
            />
          ))}
        </div>
      </AccordionPanel>
    </div>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────
export default function AlertHistory({ alerts = [], tableStatus = {} }) {
  // Group by dateIST, newest first
  const grouped = useMemo(() => {
    const map = {}
    alerts.forEach(a => {
      const d = a.dateIST || a.triggeredAt?.slice(0, 10) || 'Unknown'
      if (!map[d]) map[d] = []
      map[d].push(a)
    })
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]))
  }, [alerts])

  // Empty state
  if (!alerts.length) {
    return (
      <div style={{
        background: '#0f0f1a', border: '1px solid #1e1e30', borderRadius: 16,
        padding: '48px 24px', textAlign: 'center', marginBottom: 24,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%', background: 'rgba(124,58,237,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
        }}>
          <Bell size={22} color="#7C3AED" />
        </div>
        <p style={{ color: '#E2E8F0', fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>
          No alerts yet
        </p>
        <p style={{ color: '#475569', fontSize: 13, margin: 0 }}>
          Run a scan to detect EMA crossovers in your portfolio
        </p>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={14} color="#7C3AED" />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#94A3B8' }}>Alert History</span>
          <span style={{ fontSize: 11, color: '#334155', background: '#1e1e30', padding: '2px 8px', borderRadius: 20 }}>
            {alerts.length} unique event{alerts.length !== 1 ? 's' : ''}
          </span>
        </div>
        <span style={{ fontSize: 11, color: '#334155' }}>Daily · 1D timeframe</span>
      </div>

      {/* Date sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {grouped.map(([dateStr, dateAlerts], i) => (
          <DateSection
            key={dateStr}
            dateStr={dateStr}
            alerts={dateAlerts}
            tableStatus={tableStatus}
            defaultOpen={i === 0}
          />
        ))}
      </div>

      {/* Keyframe for slide-in — injected once */}
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>
    </div>
  )
}
