import { useEffect, useRef } from 'react'

const TV_INTERVAL = {
  '5min': '5', '15min': '15', '30min': '30',
  '1h': '60',
  'daily': 'D', 'weekly': 'W', 'monthly': 'M',
}

// Load the TradingView script once globally — subsequent calls are no-ops
let _scriptPromise = null
function loadTV() {
  if (_scriptPromise) return _scriptPromise
  if (window.TradingView?.widget) return (_scriptPromise = Promise.resolve())
  _scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://s3.tradingview.com/tv.js'
    s.async = true
    s.onload  = resolve
    s.onerror = () => { _scriptPromise = null; reject(new Error('TV script load failed')) }
    document.head.appendChild(s)
  })
  return _scriptPromise
}

// Generate a stable ID once per component mount
let _counter = 0
function nextId() { return `tv_widget_${++_counter}` }

export default function TradingViewChart({ symbol, timeframe }) {
  const divRef    = useRef(null)
  const idRef     = useRef(null)   // stable per-mount ID
  const widgetRef = useRef(null)

  if (!idRef.current) idRef.current = nextId()

  useEffect(() => {
    const containerId = idRef.current
    if (!divRef.current) return
    // Set the id on the DOM element so TradingView can find it
    divRef.current.id = containerId

    let cancelled = false

    loadTV().then(() => {
      if (cancelled || !divRef.current) return

      // Destroy any previous widget in this container
      try { widgetRef.current?.remove() } catch {}

      widgetRef.current = new window.TradingView.widget({
        autosize:            true,
        symbol:              `NSE:${symbol}`,
        interval:            TV_INTERVAL[timeframe] ?? 'D',
        timezone:            'Asia/Kolkata',
        theme:               'light',
        style:               '1',              // Candlestick
        locale:              'en',
        toolbar_bg:          '#f8f9fa',
        enable_publishing:   false,
        hide_side_toolbar:   false,            // ← drawing toolbar always visible
        allow_symbol_change: true,
        save_image:          false,
        container_id:        containerId,
        withdateranges:      true,
        hide_volume:         false,
        /* Candle colours matching our light-theme palette */
        overrides: {
          'mainSeriesProperties.candleStyle.upColor':         '#26a69a',
          'mainSeriesProperties.candleStyle.downColor':       '#ef5350',
          'mainSeriesProperties.candleStyle.borderUpColor':   '#26a69a',
          'mainSeriesProperties.candleStyle.borderDownColor': '#ef5350',
          'mainSeriesProperties.candleStyle.wickUpColor':     '#26a69a',
          'mainSeriesProperties.candleStyle.wickDownColor':   '#ef5350',
        },
      })
    }).catch(err => console.error('TradingView:', err))

    return () => {
      cancelled = true
      // Don't call widget.remove() here — TradingView cleans up its iframe
      // automatically when the container element is removed from the DOM.
    }
  }, [symbol, timeframe])  // re-mount whenever symbol or timeframe changes

  return (
    <div
      ref={divRef}
      style={{ width: '100%', height: '100%' }}
    />
  )
}
