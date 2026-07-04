import { useState, useEffect, useRef } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, Filter } from 'lucide-react'

// Shared table header controls: sortable column headers and per-column value
// filters. Used by the scan result tables (price / RS / rating screener).

export function SortHeader({ label, field, sort, onSort, align = 'left' }) {
  const active = sort.field === field
  return (
    <th
      className={`px-3 py-3 text-${align} text-xs font-semibold text-slate-500 uppercase tracking-wider
        cursor-pointer hover:text-slate-300 transition-colors whitespace-nowrap select-none`}
      onClick={() => onSort(field)}
    >
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {active
          ? sort.dir === 'asc' ? <ArrowUp size={12} className="text-violet-400" /> : <ArrowDown size={12} className="text-violet-400" />
          : <ArrowUpDown size={12} className="text-slate-700" />}
      </div>
    </th>
  )
}

// Header cell with a funnel dropdown that filters the table to one value of
// this column (e.g. RS Trend → Rising). The menu is position:fixed so it can
// never be clipped by the table's overflow/scroll container.
export function FilterHeader({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const ref = useRef(null)
  const active = value !== 'All'

  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect()
      setPos({ left: r.left, top: r.bottom + 4 })
    }
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const closeNow = () => setOpen(false)
    document.addEventListener('mousedown', close)
    // any scroll (incl. the table's own scroll container) or resize invalidates
    // the fixed anchor position — just close the menu
    window.addEventListener('scroll', closeNow, true)
    window.addEventListener('resize', closeNow)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', closeNow, true)
      window.removeEventListener('resize', closeNow)
    }
  }, [open])

  return (
    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
      <div ref={ref} className="inline-block">
        <button
          onClick={toggle}
          className={`flex items-center gap-1 select-none transition-colors
            ${active ? 'text-violet-400' : 'text-slate-500 hover:text-slate-300'}`}
          title={`Filter by ${label}`}
        >
          {label}{active && <span className="normal-case font-normal">: {value}</span>}
          <Filter size={11} className={active ? 'text-violet-400' : 'text-slate-700'} />
        </button>
        {open && (
          <div
            className="fixed z-[100] min-w-[150px] normal-case font-normal tracking-normal
              bg-[#1e1e32] border border-[#2d2d45] rounded-lg shadow-2xl overflow-hidden py-1"
            style={{ left: pos.left, top: pos.top }}
          >
            {['All', ...options].map(opt => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-[#2a2a40]
                  ${opt === value ? 'text-violet-400 font-semibold' : 'text-slate-300'}`}
              >
                {opt}
              </button>
            ))}
            {options.length === 0 && (
              <div className="px-3 py-1.5 text-xs text-slate-600">No values in these results</div>
            )}
          </div>
        )}
      </div>
    </th>
  )
}
