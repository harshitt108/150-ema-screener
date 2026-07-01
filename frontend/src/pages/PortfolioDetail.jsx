import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ArrowLeft, Plus, Upload, ClipboardList, RefreshCw, Settings2, Trash2,
  TrendingUp, TrendingDown, Minus, AlertCircle, ChevronUp, ChevronDown,
  Bell, Clock, Mail, ChevronRight
} from 'lucide-react'
import AddHoldingModal from '../components/portfolio/AddHoldingModal'
import UploadModal from '../components/portfolio/UploadModal'
import CreatePortfolioModal from '../components/portfolio/CreatePortfolioModal'
import AlertSettingsModal from '../components/portfolio/AlertSettingsModal'
import CreateRuleModal from '../components/portfolio/CreateRuleModal'
import { HealthScoreGauge, HealthBreakdown } from '../components/portfolio/HealthScoreBadge'
import StockDetailPanel from '../components/StockDetailPanel'
import { EmaGroup, MomentumGroup } from '../components/IndicatorGroups'

const API_BASE = 'http://localhost:8000'

const TYPE_LABEL = { investment: 'Investment', swing: 'Swing Trading', custom: 'Custom' }

const TIMEFRAME_LABEL = {
  '5min': '5m', '15min': '15m', '30min': '30m', '1h': '1H',
  'daily': 'D', 'weekly': 'W', 'monthly': 'M',
}

// Derive the active timeframe/period from the first enabled rule
function getRuleCtx(ruleList) {
  const first = ruleList.find(r => r.enabled && r.ruleType === 'portfolio_threshold')
    ?? ruleList.find(r => r.enabled)
  if (!first) return { timeframe: 'daily', period: 150, condition: 'above', ruleName: null }
  return { timeframe: first.timeframe, period: first.emaPeriod, condition: first.condition, ruleName: first.name }
}

function EMABadge({ emaData }) {
  if (!emaData) return <span className="text-slate-600 text-xs">—</span>
  const { above, dist } = emaData
  const sign = dist >= 0 ? '+' : ''
  if (above) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
        bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
        <TrendingUp size={10} />
        Above &nbsp;<span className="opacity-70">{sign}{dist.toFixed(1)}%</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
      bg-rose-500/10 border border-rose-500/25 text-rose-400">
      <TrendingDown size={10} />
      Below &nbsp;<span className="opacity-70">{sign}{dist.toFixed(1)}%</span>
    </span>
  )
}

// Compact ratio EMA badge for the table (3 dots: 20/50/150)
function RatioGroup({ ratioData }) {
  if (!ratioData) return <span className="text-slate-700 text-xs">—</span>
  return (
    <div className="flex flex-col gap-0.5 items-start">
      {[['ema20','20'], ['ema50','50'], ['ema150','150']].map(([key, label]) => {
        const d = ratioData[key]
        if (!d) return null
        const sign = d.dist >= 0 ? '+' : ''
        return (
          <div key={key} className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${d.above ? 'bg-emerald-400' : 'bg-rose-500'}`} />
            <span className="text-[10px] text-slate-500 w-5">{label}</span>
            <span className={`text-[10px] font-mono ${d.above ? 'text-emerald-400' : 'text-rose-400'}`}>
              {sign}{d.dist.toFixed(1)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col) return <Minus size={12} className="text-slate-700" />
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="text-violet-400" />
    : <ChevronDown size={12} className="text-violet-400" />
}

function ThBtn({ col, label, sortCol, sortDir, onSort }) {
  return (
    <button
      className="flex items-center gap-1 text-left hover:text-slate-300 transition-colors"
      onClick={() => onSort(col)}
    >
      {label}
      <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
    </button>
  )
}

export default function PortfolioDetail({ portfolioId, onBack }) {
  const [portfolio, setPortfolio] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // tableStatus: EMA data shown in the holdings table (rule-timeframe aware)
  const [tableStatus, setTableStatus] = useState({})
  const [ratioConditions, setRatioConditions] = useState({})
  const [tableTimeframe, setTableTimeframe] = useState('daily')
  const [activePeriod, setActivePeriod] = useState(150)
  const [loadingRuleData, setLoadingRuleData] = useState(false)

  // Stock detail panel
  const [selectedStock, setSelectedStock] = useState(null)
  const [selectedIdx, setSelectedIdx] = useState(null)

  // Build a stock object compatible with StockDetailPanel from our cached EMA + ratio data
  const buildStockObj = useCallback((holding) => {
    const st   = tableStatus[holding.symbol] || {}
    const ema  = st.ema || {}
    const rc   = ratioConditions[holding.symbol] || {}

    const e20  = ema['20']
    const e50  = ema['50']
    const e150 = ema['150']

    const loaded = [e20, e50, e150].filter(Boolean)
    const bullCount = loaded.filter(e => e.above).length
    const total     = loaded.length
    const pct       = total > 0 ? Math.round(bullCount / total * 100) : 0
    const signal    = pct >= 67 ? 'BUY' : pct >= 34 ? 'HOLD' : 'SELL'

    const fmt = (e) => e ? `${e.above ? 'Above' : 'Below'} (${e.dist >= 0 ? '+' : ''}${e.dist?.toFixed(1)}%)` : '—'

    return {
      symbol:    holding.symbol,
      ltp:       st.currentPrice ?? 0,
      benchmark: 'NIFTY 50',
      signals: total > 0 ? {
        signal, bullCount, total, pct,
        conditions: {
          ...(e20  && { ema20:  { label: '20 EMA',  bull: e20.above,  val: fmt(e20)  } }),
          ...(e50  && { ema50:  { label: '50 EMA',  bull: e50.above,  val: fmt(e50)  } }),
          ...(e150 && { ema150: { label: '150 EMA', bull: e150.above, val: fmt(e150) } }),
        },
      } : null,
      priceEmas: (e20 || e50 || e150) ? { ema20: e20, ema50: e50, ema150: e150 } : undefined,
      ratioEmas: (rc.ema20 || rc.ema50 || rc.ema150) ? {
        ema20:  rc.ema20,
        ema50:  rc.ema50,
        ema150: rc.ema150,
      } : undefined,
    }
  }, [tableStatus, ratioConditions])

  const openStockAt = useCallback(async (idx, holdingsList) => {
    const h = holdingsList[idx]
    if (!h) return
    setSelectedIdx(idx)
    // Open immediately with EMA-only signals from cache
    setSelectedStock(buildStockObj(h))
    // Fetch full 10–13 condition signals in background and patch in
    try {
      const tf  = encodeURIComponent(tableTimeframe)
      const bm  = encodeURIComponent('NIFTY 50')
      const res = await fetch(`${API_BASE}/api/signals/${h.symbol}?timeframe=${tf}&benchmark=${bm}`)
      if (res.ok) {
        const fullSignals = await res.json()
        setSelectedStock(prev =>
          prev?.symbol === h.symbol ? { ...prev, signals: fullSignals } : prev
        )
      }
    } catch {}
  }, [buildStockObj, tableTimeframe])

  const [health, setHealth] = useState(null)
  const [crosses, setCrosses] = useState([])
  const [recentAlerts, setRecentAlerts] = useState([])
  const [showOlderAlerts, setShowOlderAlerts] = useState(false)
  const [lastScannedAt, setLastScannedAt] = useState(null)
  const [noData, setNoData] = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const [hasRefreshed, setHasRefreshed] = useState(false)
  const [showAlertSettings, setShowAlertSettings] = useState(false)
  const [rules, setRules] = useState([])
  const [showCreateRule, setShowCreateRule] = useState(false)
  const [editRule, setEditRule] = useState(null)
  const [checkingRule, setCheckingRule] = useState(null)
  const [ruleViolations, setRuleViolations] = useState([])

  const [showAdd, setShowAdd] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

  const [editHolding, setEditHolding] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [sortCol, setSortCol] = useState('invested')
  const [sortDir, setSortDir] = useState('desc')
  const [holdingFilter, setHoldingFilter] = useState('all')  // all | alerts | bullish | bearish

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/api/portfolios/${portfolioId}`)
      if (!res.ok) throw new Error('Portfolio not found')
      setPortfolio(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [portfolioId])

  useEffect(() => { load() }, [load])

  // Fetch rule-context EMA + ratio data for the table
  const fetchRuleEma = useCallback(async (ruleList) => {
    const ctx = getRuleCtx(ruleList)
    setTableTimeframe(ctx.timeframe)
    setActivePeriod(ctx.period)
    setLoadingRuleData(true)
    try {
      const res = await fetch(
        `${API_BASE}/api/portfolios/${portfolioId}/ema-status?timeframe=${ctx.timeframe}&benchmark=NIFTY%2050`
      )
      const d = await res.json()
      if (d.status && Object.keys(d.status).length > 0) {
        setTableStatus(d.status)
        setRatioConditions(d.ratioConditions || {})
        setHasRefreshed(true)
      }
    } catch {}
    finally { setLoadingRuleData(false) }
  }, [portfolioId])

  // Load last scan result, alerts and rules on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/monitoring/last-scan/${portfolioId}`)
      .then(r => r.json())
      .then(d => {
        if (d.hasScan) {
          setHealth(d.healthDetails || { score: d.healthScore, category: d.healthCategory })
          setLastScannedAt(d.scannedAt)
          setNoData(d.noData || [])
          setCrosses(d.crosses || [])
          // Use daily scan status only as fallback (rule EMA fetch below may override)
          setTableStatus(prev => Object.keys(prev).length === 0 ? (d.status || {}) : prev)
          setHasRefreshed(true)
        }
      })
      .catch(() => {})

    fetch(`${API_BASE}/api/monitoring/alerts/${portfolioId}`)
      .then(r => r.json()).then(setRecentAlerts).catch(() => {})

    // Load rules then immediately fetch rule-context EMA
    fetch(`${API_BASE}/api/rules/portfolio/${portfolioId}`)
      .then(r => r.json())
      .then(rulesData => {
        setRules(rulesData)
        fetchRuleEma(rulesData)
      })
      .catch(() => {})
  }, [portfolioId, fetchRuleEma])

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    // Numeric columns read most-useful highest-first; symbol stays A→Z
    else { setSortCol(col); setSortDir(col === 'symbol' ? 'asc' : 'desc') }
  }

  const sortedHoldings = () => {
    if (!portfolio) return []
    const arr = [...portfolio.holdings]
    arr.sort((a, b) => {
      let va, vb
      if (sortCol === 'symbol')       { va = a.symbol;        vb = b.symbol }
      else if (sortCol === 'qty')     { va = a.quantity ?? -Infinity;       vb = b.quantity ?? -Infinity }
      else if (sortCol === 'price')   { va = a.avgBuyPrice ?? -Infinity;    vb = b.avgBuyPrice ?? -Infinity }
      else if (sortCol === 'invested') {
        va = (a.quantity != null && a.avgBuyPrice != null) ? a.quantity * a.avgBuyPrice : -Infinity
        vb = (b.quantity != null && b.avgBuyPrice != null) ? b.quantity * b.avgBuyPrice : -Infinity
      }
      else if (sortCol === 'current') {
        va = tableStatus[a.symbol]?.currentPrice ?? -Infinity
        vb = tableStatus[b.symbol]?.currentPrice ?? -Infinity
      }
      else if (sortCol === 'dist150') {
        va = tableStatus[a.symbol]?.ema?.[activePeriod.toString()]?.dist ?? -Infinity
        vb = tableStatus[b.symbol]?.ema?.[activePeriod.toString()]?.dist ?? -Infinity
      }
      else { va = a.symbol; vb = b.symbol }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch(`${API_BASE}/api/portfolios/${portfolioId}/refresh-status`, { method: 'POST' })
      if (!res.ok) throw new Error('Refresh failed')
      const data = await res.json()
      setHealth(data.health || null)
      setCrosses(data.crosses || [])
      setNoData(data.noData || [])
      setLastScannedAt(data.scannedAt || new Date().toISOString())
      setRuleViolations(data.ruleViolations || [])
      setHasRefreshed(true)

      // Reload rules then re-fetch rule-context EMA for the table
      const rulesRes = await fetch(`${API_BASE}/api/rules/portfolio/${portfolioId}`)
      const rulesData = await rulesRes.json()
      setRules(rulesData)

      const ctx = getRuleCtx(rulesData)
      setTableTimeframe(ctx.timeframe)
      setActivePeriod(ctx.period)

      // Fetch EMA + ratio for the active timeframe
      const emaRes = await fetch(
        `${API_BASE}/api/portfolios/${portfolioId}/ema-status?timeframe=${ctx.timeframe}&benchmark=NIFTY%2050`
      )
      const emaData = await emaRes.json()
      setTableStatus(emaData.status || data.status || {})
      setRatioConditions(emaData.ratioConditions || {})

      fetch(`${API_BASE}/api/monitoring/alerts/${portfolioId}`)
        .then(r => r.json()).then(setRecentAlerts).catch(() => {})
    } catch (e) {
      alert(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  const handleDeleteHolding = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`${API_BASE}/api/portfolios/${portfolioId}/holdings/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Delete failed (${res.status})`)
      setDeleteTarget(null)
      load()
    } catch (e) {
      alert(e.message || 'Failed to delete holding')
    } finally {
      setDeleting(false)
    }
  }

  const handleHoldingsAdded = () => {
    setShowAdd(false)
    setShowUpload(false)
    setEditHolding(null)
    load()
  }

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 border-4 border-[#1e1e30] rounded-full" />
        <div className="absolute inset-0 border-4 border-t-violet-500 rounded-full animate-spin" />
      </div>
    </div>
  )

  if (error) return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm">{error}</div>
    </div>
  )

  const allHoldings = sortedHoldings()
  // Stats reflect the WHOLE portfolio (not the active filter)
  const aboveCount = hasRefreshed ? allHoldings.filter(h => tableStatus[h.symbol]?.ema?.[activePeriod.toString()]?.above).length : null
  const belowCount = hasRefreshed ? allHoldings.filter(h => tableStatus[h.symbol]?.ema?.[activePeriod.toString()] && !tableStatus[h.symbol]?.ema?.[activePeriod.toString()]?.above).length : null
  const totalInvested = allHoldings.reduce((sum, h) =>
    (h.quantity != null && h.avgBuyPrice != null) ? sum + h.quantity * h.avgBuyPrice : sum, 0)

  // ── Holdings zones around the user-selected EMA / timeframe ─────────────────
  // Distance band (±%) that counts as "near" the EMA — beyond it is a clear trend.
  const NEAR_PCT = 3
  // Zone from the active EMA's signed distance:
  //   > +3%  → bullish (comfortably above)   |  -3%..+3% → near (alert/watch)
  //   < -3%  → bearish (clearly below)
  const zoneOf = (h) => {
    const d = tableStatus[h.symbol]?.ema?.[activePeriod.toString()]?.dist
    if (d == null) return null
    if (d > NEAR_PCT)  return 'bullish'
    if (d < -NEAR_PCT) return 'bearish'
    return 'near'
  }
  const matchesFilter = (h) => {
    if (holdingFilter === 'all') return true
    const z = zoneOf(h)
    if (holdingFilter === 'alerts')  return z === 'near'
    return z === holdingFilter   // 'bullish' | 'bearish'
  }
  const filterCounts = {
    all:     allHoldings.length,
    alerts:  allHoldings.filter(h => zoneOf(h) === 'near').length,
    bullish: allHoldings.filter(h => zoneOf(h) === 'bullish').length,
    bearish: allHoldings.filter(h => zoneOf(h) === 'bearish').length,
  }
  const holdings = allHoldings.filter(matchesFilter)

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Back + header */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        All Portfolios
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="flex items-start gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ backgroundColor: portfolio.color + '22', border: `1px solid ${portfolio.color}44` }}
          >
            <span className="text-xl" style={{ color: portfolio.color }}>◈</span>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-white">{portfolio.name}</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#1e1e30] text-slate-400 border border-[#2d2d45]">
                {TYPE_LABEL[portfolio.type] || portfolio.type}
              </span>
            </div>
            {portfolio.description && (
              <p className="text-sm text-slate-500 mt-1">{portfolio.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowAlertSettings(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2d2d45]
              bg-[#13131f] text-slate-400 hover:text-violet-400 hover:border-violet-500/40 text-xs font-medium transition-colors"
          >
            <Bell size={13} />
            Alerts
          </button>
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2d2d45]
              bg-[#13131f] text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors"
          >
            <Settings2 size={13} />
            Edit
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing || holdings.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
              bg-violet-600 hover:bg-violet-500 disabled:opacity-50
              text-white text-xs font-semibold transition-colors"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Scanning…' : 'Refresh & Scan'}
          </button>
        </div>
      </div>

      {/* Health + stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {/* Health gauge — always Daily */}
        <div className="sm:col-span-1">
          <HealthScoreGauge
            score={health?.score ?? null}
            category={health?.category ?? (hasRefreshed ? 'Unknown' : null)}
            details={health}
          />
        </div>
        {/* Stat cards — rule's timeframe */}
        <div className="sm:col-span-2 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Holdings" value={portfolio.holdingCount} color="text-white" />
          <StatCard
            label="Total Invested"
            value={totalInvested > 0 ? `₹${totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
            color="text-violet-300"
          />
          <StatCard
            label={`Above ${activePeriod} EMA`}
            sublabel={tableTimeframe !== 'daily' ? TIMEFRAME_LABEL[tableTimeframe] : 'Daily'}
            value={aboveCount ?? '—'}
            color="text-emerald-400"
          />
          <StatCard
            label={`Below ${activePeriod} EMA`}
            sublabel={tableTimeframe !== 'daily' ? TIMEFRAME_LABEL[tableTimeframe] : 'Daily'}
            value={belowCount ?? '—'}
            color="text-rose-400"
          />
        </div>
      </div>

      {/* Health breakdown — always Daily, score = 150(40%) + 50(25%) + 200(20%) + 20(15%) */}
      {health && health.total > 0 && (
        <div className="bg-[#0f0f1a] border border-[#1e1e30] rounded-2xl px-5 py-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-slate-500 font-medium">EMA Alignment Breakdown</p>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#1e1e30] text-slate-500 border border-[#2d2d45]">
              Daily · score weights: 150→40% · 50→25% · 200→20% · 20→15%
            </span>
          </div>
          <HealthBreakdown details={health} />
          {lastScannedAt && (
            <p className="flex items-center gap-1.5 text-xs text-slate-600 mt-3">
              <Clock size={11} />
              Last scanned {new Date(lastScannedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
      )}

      {/* ── System alerts: EMA crosses + Golden/Death cross (Daily) ───────── */}
      {crosses.length > 0 && (() => {
        // 150 EMA always first, then 50, 200, 20, then EMA/EMA crosses
        const EMA_PRIORITY = { '150': 0, '50': 1, '200': 2, '20': 3 }
        const sortCrosses = arr => [...arr].sort((a, b) => {
          // Primary: 150 EMA first (highest priority signal)
          const pa = a.cross_type === 'ema_ema' ? 99 : (EMA_PRIORITY[String(a.period)] ?? 10)
          const pb = b.cross_type === 'ema_ema' ? 99 : (EMA_PRIORITY[String(b.period)] ?? 10)
          return pa - pb
        })
        const is150 = c => c.cross_type !== 'ema_ema' && String(c.period) === '150'

        const CrossRow = (c, i, isBull) => (
          <div key={i} className={`flex items-center justify-between text-xs rounded-lg px-3 py-2.5
            border transition-colors
            ${is150(c)
              ? (isBull ? 'bg-emerald-500/15 border-emerald-500/40' : 'bg-rose-500/15 border-rose-500/40')
              : (isBull ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20')
            }`}>
            <div className="flex items-center gap-2 min-w-0">
              {is150(c) && (
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0 tracking-wide
                  ${isBull ? 'bg-emerald-500/30 text-emerald-300' : 'bg-rose-500/30 text-rose-300'}`}>
                  150 KEY
                </span>
              )}
              {c.cross_type === 'ema_ema' && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0
                  ${isBull ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                  {isBull ? '☀ GOLDEN' : '☠ DEATH'}
                </span>
              )}
              <span className={isBull ? 'text-emerald-200' : 'text-rose-200'}>
                <span className={`font-semibold ${is150(c) ? 'text-white' : ''}`}>{c.symbol}</span>
                {' — '}
                <span className="opacity-80">{c.label}</span>
              </span>
            </div>
            <span className={`flex-shrink-0 ml-3 font-mono text-[11px] ${isBull ? 'text-emerald-400' : 'text-rose-400'}`}>
              ₹{c.currentPrice?.toLocaleString('en-IN') ?? '—'}
              {c.dist != null && <span className="opacity-70"> ({c.dist >= 0 ? '+' : ''}{c.dist?.toFixed(1)}%)</span>}
            </span>
          </div>
        )

        const bullish = sortCrosses(crosses.filter(c => c.direction === 'above'))
        const bearish = sortCrosses(crosses.filter(c => c.direction === 'below'))

        return (
          <div className="bg-[#0f0f1a] border border-[#2a2a3d] rounded-2xl px-5 py-4 mb-6 space-y-4">
            <p className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
              <AlertCircle size={13} className="text-amber-400" />
              <span className="text-amber-400">{crosses.length} signal{crosses.length > 1 ? 's' : ''}</span>
              &nbsp;detected in latest scan &nbsp;
              <span className="text-slate-600 font-normal">· Daily · independent of rules</span>
            </p>

            {bullish.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <TrendingUp size={11} /> Bullish signals ({bullish.length})
                </p>
                <div className="space-y-1.5">{bullish.map((c, i) => CrossRow(c, i, true))}</div>
              </div>
            )}

            {bearish.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <TrendingDown size={11} /> Bearish signals ({bearish.length})
                </p>
                <div className="space-y-1.5">{bearish.map((c, i) => CrossRow(c, i, false))}</div>
              </div>
            )}
          </div>
        )
      })()}

      {hasRefreshed && noData.length > 0 && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs flex gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            <strong>{noData.length}</strong> symbol{noData.length > 1 ? 's' : ''} returned no data:{' '}
            <span className="font-mono">{noData.join(', ')}</span>
          </span>
        </div>
      )}

      {/* ── Rules section ─────────────────────────────────────────── */}
      <RulesSection
        rules={rules}
        violations={ruleViolations}
        portfolioId={portfolioId}
        holdingCount={portfolio.holdingCount}
        onAdd={() => setShowCreateRule(true)}
        onEdit={r => setEditRule(r)}
        onDelete={async (r) => {
          await fetch(`${API_BASE}/api/rules/${r.id}`, { method: 'DELETE' })
          const updated = rules.filter(x => x.id !== r.id)
          setRules(updated)
          fetchRuleEma(updated)   // may fall back to daily if last rule removed
        }}
        onCheckNow={async (r) => {
          setCheckingRule(r.id)
          try {
            const res = await fetch(`${API_BASE}/api/rules/${r.id}/check`, { method: 'POST' })
            const data = await res.json()
            // Refresh rule list to get updated lastCheckedAt / lastTriggeredAt
            fetch(`${API_BASE}/api/rules/portfolio/${portfolioId}`)
              .then(res => res.json()).then(setRules).catch(() => {})
            if (data.triggered) {
              setRuleViolations(v => {
                const already = v.find(x => x.ruleId === r.id)
                return already ? v : [data.violation, ...v]
              })
            }
          } finally { setCheckingRule(null) }
        }}
        checkingRule={checkingRule}
      />

      {/* Rule context banner — shown when viewing non-daily timeframe */}
      {rules.some(r => r.enabled) && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-violet-500/5 border border-violet-500/20 rounded-xl text-xs text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0 animate-pulse" />
          <span>
            Viewing <span className="text-violet-300 font-semibold">{TIMEFRAME_LABEL[tableTimeframe] || tableTimeframe}</span>
            {' '}timeframe EMA data · rule:{' '}
            <span className="text-slate-300">{getRuleCtx(rules).ruleName}</span>
          </span>
          {loadingRuleData && <RefreshCw size={10} className="ml-auto animate-spin text-violet-400" />}
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2d2d45]
            bg-[#13131f] text-slate-300 hover:text-white hover:border-violet-500/50 text-xs font-medium transition-colors"
        >
          <Plus size={13} />
          Add Stock
        </button>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2d2d45]
            bg-[#13131f] text-slate-300 hover:text-white hover:border-violet-500/50 text-xs font-medium transition-colors"
        >
          <Upload size={13} />
          Upload File
        </button>
        <button
          onClick={() => setShowUpload('paste')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2d2d45]
            bg-[#13131f] text-slate-300 hover:text-white hover:border-violet-500/50 text-xs font-medium transition-colors"
        >
          <ClipboardList size={13} />
          Paste Symbols
        </button>

        {/* Filter chips — slice holdings by signal (needs scan data) */}
        {hasRefreshed && allHoldings.length > 0 && (
          <div className="ml-auto flex items-center gap-0.5 bg-[#13131f] border border-[#1e1e30] rounded-lg p-0.5">
            {[
              { id: 'all',     label: 'All',          active: 'bg-violet-600 text-white' },
              { id: 'alerts',  label: 'Alerts (±3%)', active: 'bg-amber-500 text-white' },
              { id: 'bullish', label: 'Bullish',      active: 'bg-emerald-600 text-white' },
              { id: 'bearish', label: 'Bearish',      active: 'bg-rose-600 text-white' },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setHoldingFilter(f.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors
                  ${holdingFilter === f.id ? f.active : 'text-slate-500 hover:text-slate-300'}`}
              >
                {f.label}
                <span className={`text-[10px] ${holdingFilter === f.id ? 'opacity-80' : 'opacity-50'}`}>{filterCounts[f.id]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Holdings table */}
      {allHoldings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-500">
          <div className="w-16 h-16 rounded-2xl bg-[#13131f] border border-[#1e1e30] flex items-center justify-center mb-4">
            <ClipboardList size={24} className="text-slate-600" />
          </div>
          <p className="text-sm font-medium text-slate-400 mb-1">No holdings yet</p>
          <p className="text-xs text-center max-w-xs">Add stocks manually, upload a CSV, or paste a list of symbols.</p>
        </div>
      ) : holdings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <div className="w-14 h-14 rounded-2xl bg-[#13131f] border border-[#1e1e30] flex items-center justify-center mb-3">
            <ClipboardList size={22} className="text-slate-600" />
          </div>
          <p className="text-sm font-medium text-slate-400 mb-1">No {holdingFilter} holdings</p>
          <button onClick={() => setHoldingFilter('all')} className="text-xs text-violet-400 hover:text-violet-300 mt-1">
            Clear filter
          </button>
        </div>
      ) : (
        <div className="bg-[#0f0f1a] border border-[#1e1e30] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e1e30] text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left font-medium">
                    <ThBtn col="symbol" label="Symbol" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <ThBtn col="qty" label="Qty" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <ThBtn col="price" label="Avg Price" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <div className="flex justify-end">
                      <ThBtn col="invested" label="Invested" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    </div>
                  </th>
                  {hasRefreshed && (
                    <>
                      <th className="px-4 py-3 text-right font-medium">
                        <ThBtn col="current" label="Current" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        <ThBtn col="dist150" label="EMA" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                        {tableTimeframe !== 'daily' && (
                          <span className="ml-1 text-[9px] px-1 py-0.5 rounded font-normal bg-violet-500/20 text-violet-400">{TIMEFRAME_LABEL[tableTimeframe] || tableTimeframe}</span>
                        )}
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        RS Ratio
                        {tableTimeframe !== 'daily' && (
                          <span className="ml-1 text-[9px] px-1 py-0.5 rounded font-normal bg-amber-500/20 text-amber-400">
                            {TIMEFRAME_LABEL[tableTimeframe] || tableTimeframe}
                          </span>
                        )}
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Momentum</th>
                    </>
                  )}
                  <th className="px-4 py-3 text-left font-medium">Buy Date</th>
                  <th className="px-4 py-3 text-left font-medium">Notes</th>
                  <th className="px-4 py-3 text-center font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141420]">
                {holdings.map((h, idx) => {
                  const st = tableStatus[h.symbol]
                  const rc = ratioConditions[h.symbol]
                  const zone = zoneOf(h)   // 'bullish' | 'near' | 'bearish' | null
                  return (
                    <tr
                      key={h.id}
                      onClick={() => openStockAt(idx, holdings)}
                      className={`transition-colors group cursor-pointer
                        ${zone === 'near' ? 'bg-amber-500/5 hover:bg-amber-500/10'
                          : zone === 'bearish' ? 'bg-rose-500/3 hover:bg-rose-500/8'
                          : 'hover:bg-[#13131f]'}`}
                    >
                      <td className="px-4 py-3 font-semibold text-white">
                        <div className="flex items-center gap-2">
                          {h.symbol}
                          {zone === 'near' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-normal">Alert · near EMA</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {h.quantity != null ? h.quantity.toLocaleString() : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {h.avgBuyPrice != null ? `₹${h.avgBuyPrice.toLocaleString()}` : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-200">
                        {(h.quantity != null && h.avgBuyPrice != null)
                          ? `₹${(h.quantity * h.avgBuyPrice).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                          : <span className="text-slate-600">—</span>}
                      </td>
                      {hasRefreshed && (
                        <>
                          <td className="px-4 py-3 text-right font-medium text-slate-200">
                            {st?.currentPrice != null ? `₹${st.currentPrice.toLocaleString('en-IN')}` : <span className="text-rose-500/70 text-xs">no data</span>}
                          </td>
                          <td className="px-4 py-3">
                            <EmaGroup panel={st?.ema} />
                          </td>
                          <td className="px-4 py-3">
                            <EmaGroup panel={rc} />
                          </td>
                          <td className="px-4 py-3">
                            <MomentumGroup source={st?.momentum} />
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {h.buyDate ? new Date(h.buyDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs max-w-[140px] truncate">
                        {h.notes || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setEditHolding(h)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-[#1e1e30] transition-colors"
                            title="Edit"
                          >
                            <Settings2 size={13} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(h)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Remove"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock detail panel (right-side slide-in, same as EMA Scanner) */}
      {selectedStock && (
        <StockDetailPanel
          stock={selectedStock}
          timeframe={tableTimeframe}
          onClose={() => setSelectedStock(null)}
          onPrev={() => openStockAt(Math.max(0, selectedIdx - 1), holdings)}
          onNext={() => openStockAt(Math.min(holdings.length - 1, selectedIdx + 1), holdings)}
          currentIndex={selectedIdx}
          totalCount={holdings.length}
        />
      )}

      {/* Modals */}
      {(showAdd || editHolding) && (
        <AddHoldingModal
          portfolioId={portfolioId}
          holding={editHolding}
          onSave={handleHoldingsAdded}
          onClose={() => { setShowAdd(false); setEditHolding(null) }}
        />
      )}

      {showUpload && (
        <UploadModal
          portfolioId={portfolioId}
          defaultTab={showUpload === 'paste' ? 'paste' : 'file'}
          onSave={handleHoldingsAdded}
          onClose={() => setShowUpload(false)}
        />
      )}

      {/* ── Alert History (7 days, date-grouped) ──────────────────────────── */}
      {false && (() => {
        const parseAlert = (a) => {
          const at = a.alertType
          if (at === 'golden_cross') return { direction: 'above', period: null, label: 'Golden Cross — 20 EMA crossed above 50 EMA', badge: '☀ GOLDEN', isEmaEma: true }
          if (at === 'death_cross')  return { direction: 'below', period: null, label: 'Death Cross — 20 EMA crossed below 50 EMA',  badge: '☠ DEATH',  isEmaEma: true }
          const parts = at.split('_')            // ['cross','above','150']
          const dir   = parts[1] === 'above' ? 'above' : 'below'
          const per   = parts[2] || ''
          return { direction: dir, period: per, label: `crossed ${dir} the ${per} EMA`, badge: null, isEmaEma: false }
        }

        // "Still active" check using latest tableStatus in state
        const isStillActive = (a, parsed) => {
          const st = tableStatus[a.symbol]?.ema
          if (!st) return null  // no data yet
          if (parsed.isEmaEma) {
            const e20 = tableStatus[a.symbol]?.ema?.['20']?.value
            const e50 = tableStatus[a.symbol]?.ema?.['50']?.value
            if (e20 == null || e50 == null) return null
            return parsed.direction === 'above' ? e20 > e50 : e20 < e50
          }
          const emaState = st[parsed.period]
          if (!emaState) return null
          return parsed.direction === 'above' ? emaState.above : !emaState.above
        }

        // Group by dateIST, newest date first
        const byDate = {}
        recentAlerts.forEach(a => {
          const d = a.dateIST || a.triggeredAt?.slice(0,10) || 'Unknown'
          if (!byDate[d]) byDate[d] = []
          byDate[d].push(a)
        })
        const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a))

        // IST today for "Today" / "Yesterday" labels
        const IST_OFFSET = 5.5 * 60 * 60 * 1000
        const nowIST   = new Date(Date.now() + IST_OFFSET)
        const todayIST = nowIST.toISOString().slice(0,10)
        const ystIST   = new Date(+nowIST - 86400000).toISOString().slice(0,10)
        const fmtDate  = d => d === todayIST ? 'Today' : d === ystIST ? 'Yesterday'
          : new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year: new Date(d).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })

        const RECENT_DAYS = 7
        const recentDates = dates.filter(d => {
          const diff = (new Date(todayIST) - new Date(d)) / 86400000
          return diff < RECENT_DAYS
        })
        const olderDates  = dates.filter(d => {
          const diff = (new Date(todayIST) - new Date(d)) / 86400000
          return diff >= RECENT_DAYS
        })
        const visibleDates = showOlderAlerts ? dates : recentDates

        return (
          <div className="bg-[#0f0f1a] border border-[#1e1e30] rounded-2xl px-5 py-4 mb-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                <Bell size={12} className="text-violet-400" />
                Alert History
                <span className="ml-1 text-slate-600">· {recentAlerts.length} unique event{recentAlerts.length !== 1 ? 's' : ''}</span>
              </p>
              <span className="text-[10px] text-slate-600">Daily · deduplicated</span>
            </div>

            {/* Date groups */}
            <div className="space-y-5">
              {visibleDates.map(date => (
                <div key={date}>
                  {/* Date label */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      {fmtDate(date)}
                    </span>
                    <div className="flex-1 h-px bg-[#1e1e30]" />
                    <span className="text-[10px] text-slate-700">{byDate[date].length} signal{byDate[date].length !== 1 ? 's' : ''}</span>
                  </div>

                  {/* Alert rows */}
                  <div className="space-y-1.5">
                    {byDate[date].map(a => {
                      const parsed  = parseAlert(a)
                      const active  = isStillActive(a, parsed)
                      const isBull  = parsed.direction === 'above'
                      return (
                        <div key={a.id}
                          className={`flex items-center justify-between text-xs rounded-lg px-3 py-2
                            ${isBull ? 'bg-emerald-500/10 border border-emerald-500/15' : 'bg-rose-500/10 border border-rose-500/15'}`}>
                          {/* Left */}
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isBull ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            {parsed.badge && (
                              <span className={`text-[9px] font-bold px-1 py-0.5 rounded flex-shrink-0
                                ${isBull ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                                {parsed.badge}
                              </span>
                            )}
                            <span className={`font-semibold ${isBull ? 'text-emerald-200' : 'text-rose-200'}`}>{a.symbol}</span>
                            <span className="text-slate-500 truncate">{parsed.label}</span>
                            {a.emailSent && <Mail size={9} className="text-violet-400 flex-shrink-0" title="Email sent" />}
                          </div>
                          {/* Right */}
                          <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                            {a.currentPrice != null && (
                              <span className="font-mono text-[11px] text-slate-400">
                                ₹{a.currentPrice.toLocaleString('en-IN')}
                                {a.distancePct != null && (
                                  <span className={`ml-1 ${isBull ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    ({a.distancePct >= 0 ? '+' : ''}{a.distancePct?.toFixed(1)}%)
                                  </span>
                                )}
                              </span>
                            )}
                            {/* Still active badge */}
                            {active === true && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold
                                ${isBull ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                                ● Active
                              </span>
                            )}
                            {active === false && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-slate-500/15 text-slate-500">
                                ✓ Recovered
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Show older toggle */}
            {olderDates.length > 0 && (
              <button
                onClick={() => setShowOlderAlerts(v => !v)}
                className="mt-4 w-full flex items-center justify-center gap-1.5 text-[11px] text-slate-600
                  hover:text-slate-400 transition-colors py-1.5 border-t border-[#1e1e30]">
                <ChevronRight size={12} className={`transition-transform ${showOlderAlerts ? 'rotate-90' : ''}`} />
                {showOlderAlerts
                  ? 'Show less'
                  : `Show ${olderDates.length} older day${olderDates.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        )
      })()}

      {/* Recent alerts history */}
      {recentAlerts.length > 0 && (
        <div className="bg-[#0f0f1a] border border-[#1e1e30] rounded-2xl px-5 py-4 mb-6">
          <p className="text-xs text-slate-400 font-medium mb-3 flex items-center gap-1.5">
            <Bell size={12} className="text-violet-400" />
            Recent Alerts
          </p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {recentAlerts.map(a => {
              const isBelow = a.alertType.includes('below')
              const at = a.alertType
              const label = at === 'golden_cross' ? 'Golden Cross' :
                            at === 'death_cross'  ? 'Death Cross'  :
                            `${isBelow ? 'below' : 'above'} ${at.split('_').pop()} EMA`
              return (
                <div key={a.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isBelow ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                    <span className="font-semibold text-slate-300">{a.symbol}</span>
                    <span className="text-slate-500">{label}</span>
                    {a.emailSent && <Mail size={10} className="text-violet-400" title="Email sent" />}
                  </div>
                  <span className="text-slate-600">
                    {new Date(a.triggeredAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {showEdit && (
        <CreatePortfolioModal
          portfolio={portfolio}
          onSave={() => { setShowEdit(false); load() }}
          onClose={() => setShowEdit(false)}
        />
      )}

      {(showCreateRule || editRule) && (
        <CreateRuleModal
          portfolioId={portfolioId}
          holdingCount={portfolio.holdingCount}
          rule={editRule}
          onSave={(saved) => {
            const updated = editRule
              ? rules.map(r => r.id === saved.id ? saved : r)
              : [...rules, saved]
            setRules(updated)
            fetchRuleEma(updated)   // re-fetch EMA data for the new timeframe immediately
            setShowCreateRule(false)
            setEditRule(null)
          }}
          onClose={() => { setShowCreateRule(false); setEditRule(null) }}
        />
      )}

      {showAlertSettings && (
        <AlertSettingsModal
          portfolioId={portfolioId}
          portfolioName={portfolio.name}
          onClose={() => setShowAlertSettings(false)}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#0f0f1a] border border-[#2d2d45] rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-white mb-2">Remove Holding</h3>
            <p className="text-sm text-slate-400 mb-6">
              Remove <span className="text-white font-semibold">{deleteTarget.symbol}</span> from this portfolio?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 px-4 py-2 rounded-xl border border-[#2d2d45] text-slate-400
                  hover:text-slate-200 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteHolding}
                disabled={deleting}
                className="flex-1 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500
                  disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, sublabel, value, color }) {
  return (
    <div className="bg-[#0f0f1a] border border-[#1e1e30] rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-xs text-slate-500">{label}</p>
        {sublabel && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-[#1e1e30] border border-[#2d2d45] text-slate-600">
            {sublabel}
          </span>
        )}
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function RulesSection({ rules, violations, portfolioId, holdingCount, onAdd, onEdit, onDelete, onCheckNow, checkingRule }) {
  const violatedIds = new Set(violations.map(v => v.ruleId))

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-white flex items-center gap-2">
          Monitoring Rules
          {rules.length > 0 && (
            <span className="text-xs bg-[#1e1e30] text-slate-400 px-2 py-0.5 rounded-full">{rules.length}</span>
          )}
        </p>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2d2d45]
            bg-[#13131f] text-slate-300 hover:text-white hover:border-violet-500/50 text-xs font-medium transition-colors"
        >
          <Plus size={12} /> Add Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="border border-dashed border-[#2d2d45] rounded-2xl p-6 text-center text-slate-600">
          <Bell size={20} className="mx-auto mb-2 text-slate-700" />
          <p className="text-sm">No monitoring rules yet.</p>
          <p className="text-xs mt-1">Add a rule to get alerted when EMA conditions are met.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map(rule => {
            const isTriggered = violatedIds.has(rule.id)
            const isChecking  = checkingRule === rule.id
            return (
              <div
                key={rule.id}
                className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3
                  ${isTriggered
                    ? 'bg-amber-500/5 border-amber-500/30'
                    : 'bg-[#0f0f1a] border-[#1e1e30]'
                  }`}
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {/* Status dot */}
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5
                    ${isTriggered ? 'bg-amber-400 animate-pulse' : rule.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-white truncate">{rule.name}</p>
                      {/* Badges */}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e1e30] text-slate-500 font-mono">
                        {TIMEFRAME_LABEL[rule.timeframe] || rule.timeframe}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400">
                        {rule.emaPeriod} EMA
                      </span>
                      {isTriggered && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">
                          ⚡ Triggered
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{rule.description}</p>
                    {rule.lastTriggeredAt && (
                      <p className="text-xs text-slate-600 mt-0.5">
                        Last triggered: {new Date(rule.lastTriggeredAt).toLocaleString('en-IN', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    )}
                  </div>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => onCheckNow(rule)}
                    disabled={isChecking}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-500
                      hover:text-violet-400 hover:bg-violet-500/10 transition-colors disabled:opacity-50"
                    title="Check now"
                  >
                    <RefreshCw size={11} className={isChecking ? 'animate-spin' : ''} />
                    {isChecking ? 'Checking…' : 'Check'}
                  </button>
                  <button
                    onClick={() => onEdit(rule)}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-[#1e1e30] transition-colors"
                    title="Edit"
                  >
                    <Settings2 size={12} />
                  </button>
                  <button
                    onClick={() => onDelete(rule)}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Rule violations from latest scan */}
      {violations.length > 0 && (
        <div className="mt-3 bg-amber-500/5 border border-amber-500/25 rounded-xl px-4 py-3">
          <p className="text-xs text-amber-400 font-medium mb-2">
            ⚡ {violations.length} rule{violations.length > 1 ? 's' : ''} triggered in latest scan
          </p>
          {violations.map((v, i) => (
            <div key={i} className="mt-2">
              <div className="text-xs text-slate-400 flex items-start gap-2">
                <span className="text-amber-400 flex-shrink-0 mt-0.5">→</span>
                <div className="flex-1 min-w-0">
                  <span className="text-white font-medium">{v.ruleName}: </span>
                  {v.ruleType === 'portfolio_threshold' ? (
                    <>
                      <span className="text-amber-300 font-semibold">{v.matching}/{v.total}</span>
                      {' '}stocks are {v.condition}{' '}
                      <span className="font-medium">{v.emaPeriod} EMA</span>
                      {' '}on {TIMEFRAME_LABEL[v.timeframe] || v.timeframe}
                      {/* List the actual stocks */}
                      {v.breakdown?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {v.breakdown.map(b => (
                            <span key={b.symbol}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                                bg-rose-500/10 border border-rose-500/25 text-rose-300 font-mono text-[11px]">
                              {b.symbol}
                              <span className="text-rose-500 text-[10px]">
                                {b.dist >= 0 ? '+' : ''}{b.dist?.toFixed(1)}%
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="text-rose-300 font-mono">{v.symbol}</span>
                      {' '}is {v.condition}{' '}
                      <span className="font-medium">{v.emaPeriod} EMA</span>
                      {' '}
                      <span className="text-rose-400 font-mono">
                        ({v.dist >= 0 ? '+' : ''}{v.dist?.toFixed(1)}%)
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
