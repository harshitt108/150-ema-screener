import { useState, useEffect } from 'react'
import { Check, X, Info, AlertTriangle } from 'lucide-react'

// ─── Tiny global toast store (pub/sub) ───────────────────────────────────────
let _id = 0
let listeners = []

/** Show a toast. type: 'success' | 'info' | 'error' */
export function toast(message, type = 'success') {
  const t = { id: ++_id, message, type }
  listeners.forEach(fn => fn(t))
}

function subscribe(fn) {
  listeners.push(fn)
  return () => { listeners = listeners.filter(l => l !== fn) }
}

const STYLES = {
  success: { icon: Check,          ring: 'border-emerald-500/40', accent: 'text-emerald-400', dot: 'bg-emerald-400' },
  info:    { icon: Info,           ring: 'border-violet-500/40',  accent: 'text-violet-400',  dot: 'bg-violet-400'  },
  error:   { icon: AlertTriangle,  ring: 'border-rose-500/40',    accent: 'text-rose-400',    dot: 'bg-rose-400'    },
}

/** Mount once near the app root. Listens for toast() calls and renders them. */
export default function Toaster() {
  const [items, setItems] = useState([])

  useEffect(() => subscribe(t => {
    setItems(prev => [...prev, t])
    setTimeout(() => setItems(prev => prev.filter(i => i.id !== t.id)), 2600)
  }), [])

  if (!items.length) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[2000] flex flex-col items-center gap-2 pointer-events-none">
      {items.map(t => {
        const s = STYLES[t.type] || STYLES.success
        const Icon = s.icon
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2.5 pl-3 pr-2 py-2.5 rounded-xl
              bg-[#15151f]/95 backdrop-blur border ${s.ring} shadow-2xl
              animate-[toastIn_0.18s_ease-out]`}
          >
            <span className={`flex items-center justify-center w-5 h-5 rounded-full bg-white/5 ${s.accent}`}>
              <Icon size={13} />
            </span>
            <span className="text-sm text-slate-200 font-medium whitespace-nowrap">{t.message}</span>
            <button
              onClick={() => setItems(prev => prev.filter(i => i.id !== t.id))}
              className="p-1 rounded-md text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-colors"
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
