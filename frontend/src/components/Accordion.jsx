import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export default function Accordion({ title, defaultOpen = true, badge, children }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-[#1e1e30] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-[#13131f] hover:bg-[#171726] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{title}</span>
          {badge != null && (
            <span className="text-[10px] font-mono text-slate-500 bg-[#1e1e30] px-1.5 py-0.5 rounded">{badge}</span>
          )}
        </div>
        <ChevronDown size={15} className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="p-3 bg-[#0d0d18]">
          {children}
        </div>
      )}
    </div>
  )
}
