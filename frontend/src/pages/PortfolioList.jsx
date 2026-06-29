import { useState, useEffect } from 'react'
import { Plus, Briefcase, TrendingUp, Zap, Settings2, Trash2, ChevronRight, BarChart2 } from 'lucide-react'
import CreatePortfolioModal from '../components/portfolio/CreatePortfolioModal'
import { HealthScoreChip } from '../components/portfolio/HealthScoreBadge'

const API_BASE = 'http://localhost:8000'

const TYPE_META = {
  investment: { label: 'Investment',    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25', icon: TrendingUp },
  swing:      { label: 'Swing Trading', color: 'text-violet-400 bg-violet-500/10  border-violet-500/25',  icon: Zap         },
  custom:     { label: 'Custom',        color: 'text-slate-400  bg-slate-500/10   border-slate-500/25',   icon: Settings2   },
}

function TypeBadge({ type }) {
  const meta = TYPE_META[type] || TYPE_META.custom
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${meta.color}`}>
      <Icon size={10} />
      {meta.label}
    </span>
  )
}

function PortfolioCard({ portfolio, onOpen, onEdit, onDelete }) {
  return (
    <div
      className="group relative bg-[#0f0f1a] border border-[#1e1e30] rounded-2xl p-5 cursor-pointer
        hover:border-[#2d2d45] hover:bg-[#13131f] transition-all duration-200"
      onClick={() => onOpen(portfolio)}
    >
      {/* Color accent bar */}
      <div className="absolute top-0 left-5 right-5 h-0.5 rounded-b-full" style={{ backgroundColor: portfolio.color }} />

      <div className="flex items-start justify-between mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: portfolio.color + '22', border: `1px solid ${portfolio.color}44` }}
        >
          <Briefcase size={18} style={{ color: portfolio.color }} />
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onEdit(portfolio)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-[#1e1e30] transition-colors"
            title="Edit portfolio"
          >
            <Settings2 size={14} />
          </button>
          <button
            onClick={() => onDelete(portfolio)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            title="Delete portfolio"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <h3 className="text-base font-semibold text-white mb-1 leading-tight">{portfolio.name}</h3>
      {portfolio.description && (
        <p className="text-xs text-slate-500 mb-3 leading-relaxed line-clamp-2">{portfolio.description}</p>
      )}

      <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
        <TypeBadge type={portfolio.type} />
        <div className="flex items-center gap-2">
          {portfolio.healthScore != null && (
            <HealthScoreChip score={portfolio.healthScore} category={portfolio.healthCategory} />
          )}
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <BarChart2 size={12} />
            <span>{portfolio.holdingCount}</span>
          </div>
        </div>
      </div>

      <div className="absolute right-4 bottom-4 text-slate-700 group-hover:text-slate-500 transition-colors">
        <ChevronRight size={16} />
      </div>
    </div>
  )
}

export default function PortfolioList({ onOpen }) {
  const [portfolios, setPortfolios] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/api/portfolios`)
      if (!res.ok) throw new Error('Failed to load portfolios')
      setPortfolios(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSaved = (portfolio) => {
    setShowCreate(false)
    setEditTarget(null)
    load()
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`${API_BASE}/api/portfolios/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Delete failed (${res.status})`)
      setDeleteTarget(null)
      load()
    } catch (e) {
      alert(e.message || 'Failed to delete portfolio')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">Portfolio Guardian</h2>
          <p className="text-sm text-slate-500 mt-1">Monitor the technical health of your holdings</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500
            text-white text-sm font-semibold transition-colors"
        >
          <Plus size={16} />
          New Portfolio
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-32">
          <div className="relative w-10 h-10">
            <div className="absolute inset-0 border-4 border-[#1e1e30] rounded-full" />
            <div className="absolute inset-0 border-4 border-t-violet-500 rounded-full animate-spin" />
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && portfolios.length === 0 && (
        <div className="flex flex-col items-center justify-center py-32 text-slate-500">
          <div className="w-20 h-20 rounded-2xl bg-[#13131f] border border-[#1e1e30] flex items-center justify-center mb-6">
            <Briefcase size={32} className="text-violet-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-300 mb-2">No portfolios yet</h3>
          <p className="text-sm text-center max-w-xs leading-relaxed mb-6">
            Create your first portfolio to start monitoring the technical health of your holdings.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500
              text-white text-sm font-semibold transition-colors"
          >
            <Plus size={16} />
            Create Portfolio
          </button>
        </div>
      )}

      {!loading && portfolios.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {portfolios.map(p => (
            <PortfolioCard
              key={p.id}
              portfolio={p}
              onOpen={onOpen}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
            />
          ))}
          {/* New portfolio card */}
          <button
            onClick={() => setShowCreate(true)}
            className="bg-[#0f0f1a] border border-dashed border-[#2d2d45] rounded-2xl p-5
              flex flex-col items-center justify-center gap-3 text-slate-600
              hover:border-violet-500/50 hover:text-violet-400 hover:bg-[#13131f]
              transition-all duration-200 min-h-[160px]"
          >
            <div className="w-10 h-10 rounded-xl border border-current flex items-center justify-center">
              <Plus size={18} />
            </div>
            <span className="text-sm font-medium">New Portfolio</span>
          </button>
        </div>
      )}

      {/* Modals */}
      {(showCreate || editTarget) && (
        <CreatePortfolioModal
          portfolio={editTarget}
          onSave={handleSaved}
          onClose={() => { setShowCreate(false); setEditTarget(null) }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#0f0f1a] border border-[#2d2d45] rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-white mb-2">Delete Portfolio</h3>
            <p className="text-sm text-slate-400 mb-6">
              Delete <span className="text-white font-medium">"{deleteTarget.name}"</span>?
              This will permanently remove all {deleteTarget.holdingCount} holdings.
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
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500
                  disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
