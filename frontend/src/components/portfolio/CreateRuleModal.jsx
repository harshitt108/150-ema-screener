import { useState, useEffect } from 'react'
import { X, Users, TrendingDown, ChevronRight } from 'lucide-react'

const API_BASE = 'http://localhost:8000'

const TIMEFRAMES = [
  { value: '5min',    label: '5 Minutes' },
  { value: '15min',   label: '15 Minutes' },
  { value: '30min',   label: '30 Minutes' },
  { value: '1h',      label: '1 Hour' },
  { value: 'daily',   label: 'Daily' },
  { value: 'weekly',  label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

const EMA_PERIODS = [20, 50, 150, 200]

const CONDITIONS = [
  { value: 'below', label: 'Below' },
  { value: 'above', label: 'Above' },
]

const OPERATORS = [
  { value: 'gte', label: 'or more (≥)' },
  { value: 'lte', label: 'or fewer (≤)' },
  { value: 'eq',  label: 'exactly (=)' },
]

function Select({ value, onChange, options, className = '' }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5 text-sm text-white
        focus:outline-none focus:border-violet-500/60 transition-colors appearance-none cursor-pointer ${className}`}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function TypeCard({ id, icon: Icon, title, desc, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all w-full
        ${selected
          ? 'border-violet-500/60 bg-violet-500/10'
          : 'border-[#2d2d45] bg-[#13131f] hover:border-[#3d3d55]'
        }`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
        ${selected ? 'bg-violet-500/20' : 'bg-[#1e1e30]'}`}>
        <Icon size={15} className={selected ? 'text-violet-400' : 'text-slate-500'} />
      </div>
      <div>
        <p className={`text-sm font-semibold ${selected ? 'text-white' : 'text-slate-300'}`}>{title}</p>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </button>
  )
}

export default function CreateRuleModal({ portfolioId, holdingCount = 0, rule, onSave, onClose }) {
  const isEdit = Boolean(rule)

  const [ruleType,       setRuleType]       = useState(rule?.ruleType       ?? 'portfolio_threshold')
  const [name,           setName]           = useState(rule?.name           ?? '')
  const [timeframe,      setTimeframe]      = useState(rule?.timeframe      ?? '1h')
  const [emaPeriod,      setEmaPeriod]      = useState(rule?.emaPeriod      ?? 150)
  const [condition,      setCondition]      = useState(rule?.condition      ?? 'below')
  const [operator,       setOperator]       = useState(rule?.operator       ?? 'gte')
  const [thresholdType,  setThresholdType]  = useState(rule?.thresholdType  ?? 'count')
  const [thresholdValue, setThresholdValue] = useState(rule?.thresholdValue?.toString() ?? '1')
  const [symbol,         setSymbol]         = useState(rule?.symbol         ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Auto-generate name whenever key fields change (create AND edit)
  useEffect(() => {
    const tf = TIMEFRAMES.find(t => t.value === timeframe)?.label ?? timeframe
    if (ruleType === 'portfolio_threshold') {
      const v    = thresholdValue || '?'
      const unit = thresholdType === 'percent' ? '%' : ''
      const op   = operator === 'gte' ? '≥' : operator === 'lte' ? '≤' : '='
      setName(`${op}${v}${unit} stocks ${condition} ${emaPeriod} EMA (${tf})`)
    } else if (symbol) {
      setName(`${symbol} ${condition} ${emaPeriod} EMA (${tf})`)
    }
  }, [ruleType, timeframe, emaPeriod, condition, operator, thresholdType, thresholdValue, symbol])

  const rulePreview = () => {
    const tf = TIMEFRAMES.find(t => t.value === timeframe)?.label ?? timeframe
    if (ruleType === 'portfolio_threshold') {
      const op   = OPERATORS.find(o => o.value === operator)?.label ?? operator
      const unit = thresholdType === 'percent' ? '%' : ' stocks'
      return `Alert when ${thresholdValue}${unit} ${op} are ${condition} the ${emaPeriod} EMA on ${tf}`
    }
    return `Alert when ${symbol || '?'} is ${condition} the ${emaPeriod} EMA on ${tf}`
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setError('Rule name is required'); return }
    if (ruleType === 'stock_ema' && !symbol.trim()) { setError('Symbol is required'); return }

    setSaving(true); setError(null)
    try {
      const body = {
        name:             name.trim(),
        rule_type:        ruleType,
        timeframe,
        ema_period:       Number(emaPeriod),
        condition,
        operator:         ruleType === 'portfolio_threshold' ? operator : null,
        threshold_type:   ruleType === 'portfolio_threshold' ? thresholdType : null,
        threshold_value:  ruleType === 'portfolio_threshold' ? Number(thresholdValue) : null,
        symbol:           ruleType === 'stock_ema' ? symbol.trim().toUpperCase() : null,
      }

      const url = isEdit
        ? `${API_BASE}/api/rules/${rule.id}`
        : `${API_BASE}/api/rules/portfolio/${portfolioId}`
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to save')
      onSave(await res.json())
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0f0f1a] border border-[#2d2d45] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e30] sticky top-0 bg-[#0f0f1a] z-10">
          <h2 className="text-base font-semibold text-white">
            {isEdit ? 'Edit Rule' : 'Create Monitoring Rule'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-[#1e1e30]">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Rule type */}
          {!isEdit && (
            <div>
              <label className="block text-xs text-slate-400 font-medium mb-2">Rule Type</label>
              <div className="grid grid-cols-1 gap-2">
                <TypeCard
                  id="portfolio_threshold" icon={Users}
                  title="Portfolio Breadth"
                  desc="Alert when X stocks in the portfolio are above/below an EMA on a given timeframe."
                  selected={ruleType === 'portfolio_threshold'}
                  onClick={setRuleType}
                />
                <TypeCard
                  id="stock_ema" icon={TrendingDown}
                  title="Individual Stock"
                  desc="Alert when a specific stock is above or below an EMA on a given timeframe."
                  selected={ruleType === 'stock_ema'}
                  onClick={setRuleType}
                />
              </div>
            </div>
          )}

          {/* Condition builder */}
          <div className="bg-[#13131f] border border-[#1e1e30] rounded-2xl p-4 space-y-4">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Condition</p>

            {ruleType === 'portfolio_threshold' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-slate-400">When</span>
                  <input
                    type="number"
                    value={thresholdValue}
                    onChange={e => setThresholdValue(e.target.value)}
                    min="1"
                    max={thresholdType === 'percent' ? 100 : holdingCount || 999}
                    step="1"
                    className="w-16 bg-[#0f0f1a] border border-[#2d2d45] rounded-lg px-2 py-1.5 text-sm
                      text-white text-center focus:outline-none focus:border-violet-500/60"
                  />
                  <Select
                    value={thresholdType}
                    onChange={setThresholdType}
                    options={[
                      { value: 'count',   label: 'stocks' },
                      { value: 'percent', label: '% of stocks' },
                    ]}
                  />
                  <Select value={operator} onChange={setOperator} options={OPERATORS} />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-slate-400">are</span>
                  <Select value={condition} onChange={setCondition} options={CONDITIONS} />
                  <span className="text-sm text-slate-400">the</span>
                  <Select
                    value={emaPeriod}
                    onChange={v => setEmaPeriod(Number(v))}
                    options={EMA_PERIODS.map(p => ({ value: p, label: `${p} EMA` }))}
                  />
                  <span className="text-sm text-slate-400">on</span>
                  <Select value={timeframe} onChange={setTimeframe} options={TIMEFRAMES} />
                </div>
              </div>
            )}

            {ruleType === 'stock_ema' && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-slate-400">When</span>
                <input
                  type="text"
                  value={symbol}
                  onChange={e => setSymbol(e.target.value.toUpperCase())}
                  placeholder="SYMBOL"
                  className="w-28 bg-[#0f0f1a] border border-[#2d2d45] rounded-lg px-2 py-1.5 text-sm
                    text-white font-mono placeholder-slate-600 focus:outline-none focus:border-violet-500/60"
                />
                <span className="text-sm text-slate-400">is</span>
                <Select value={condition} onChange={setCondition} options={CONDITIONS} />
                <span className="text-sm text-slate-400">the</span>
                <Select
                  value={emaPeriod}
                  onChange={v => setEmaPeriod(Number(v))}
                  options={EMA_PERIODS.map(p => ({ value: p, label: `${p} EMA` }))}
                />
                <span className="text-sm text-slate-400">on</span>
                <Select value={timeframe} onChange={setTimeframe} options={TIMEFRAMES} />
              </div>
            )}

            {/* Preview sentence */}
            <div className="mt-2 pt-3 border-t border-[#1e1e30]">
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <ChevronRight size={11} className="text-violet-400" />
                {rulePreview()}
              </p>
            </div>
          </div>

          {/* Rule name */}
          <div>
            <label className="block text-xs text-slate-400 font-medium mb-1.5">Rule Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Breadth Weakness Alert"
              className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5
                text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-[#2d2d45] text-slate-400
                hover:text-slate-200 text-sm font-medium transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500
                disabled:opacity-50 text-white text-sm font-semibold transition-colors">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
