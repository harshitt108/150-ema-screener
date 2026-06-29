import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, LineStyle } from 'lightweight-charts'

// Price pane EMA colours
const PRICE_EMA = {
  ema20:  { color: '#2196F3', lineWidth: 1.5, title: '20 EMA'  },
  ema50:  { color: '#7B1FA2', lineWidth: 1.5, title: '50 EMA'  },
  ema150: { color: '#212121', lineWidth: 2,   title: '150 EMA' },
}

// Ratio pane colours
const RATIO_STYLE = {
  line:  { color: '#2196F3', lineWidth: 1.5, title: 'Ratio'    },
  ema20: { color: '#FF9800', lineWidth: 1.5, title: '20 EMA'   },
  ema150:{ color: '#424242', lineWidth: 1.5, title: '150 EMA', lineStyle: LineStyle.Dashed },
}

// Pane indices — MACD sits between price and ratio
const MAIN_PANE  = 0
const MACD_PANE  = 1
const RATIO_PANE = 2

export default function CandleChart({
  candles, ema20, ema50, ema150,
  macdLine, macdSignal, macdHistogram,
  ratioLine, ratioEma20, ratioEma150,
  height = 500,
  onReady,
}) {
  const containerRef = useRef(null)

  const hasMacd  = macdLine?.length > 0
  const hasRatio = ratioLine?.length > 0

  useEffect(() => {
    if (!containerRef.current || !candles?.length) return

    let chart = null
    try {
      chart = createChart(containerRef.current, {
        width:  containerRef.current.clientWidth,
        height,
        layout: {
          background: { color: '#ffffff' },
          textColor:  '#333333',
          fontSize:   11,
        },
        grid: {
          vertLines: { color: '#f0f0f0' },
          horzLines: { color: '#f0f0f0' },
        },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#cccccc' },
        timeScale: {
          borderColor:    '#cccccc',
          timeVisible:    true,
          secondsVisible: false,
        },
      })

      // ── Pane 0: Price + EMAs ───────────────────────────────────────────
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor:         '#26a69a',
        downColor:       '#ef5350',
        borderUpColor:   '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor:     '#26a69a',
        wickDownColor:   '#ef5350',
      }, MAIN_PANE)
      candleSeries.setData(candles)

      const addLine = (data, style, pane = MAIN_PANE) => {
        if (!data?.length) return
        const s = chart.addSeries(LineSeries, {
          color:            style.color,
          lineWidth:        style.lineWidth,
          lineStyle:        style.lineStyle ?? LineStyle.Solid,
          title:            style.title,
          priceLineVisible: false,
          lastValueVisible: true,
        }, pane)
        s.setData(data)
      }

      addLine(ema20,  PRICE_EMA.ema20)
      addLine(ema50,  PRICE_EMA.ema50)
      addLine(ema150, PRICE_EMA.ema150)

      // Expose chart API for the drawing overlay
      onReady?.({ chart, mainSeries: candleSeries })

      // ── Pane 1: MACD(12,26,9) ─────────────────────────────────────────
      // Simple: histogram (green above 0, red below 0) + MACD line + Signal line.
      if (hasMacd) {
        if (macdHistogram?.length) {
          const hist = chart.addSeries(HistogramSeries, {
            base:             0,
            priceLineVisible: false,
            lastValueVisible: false,
          }, MACD_PANE)
          hist.setData(macdHistogram)
        }

        if (macdLine?.length) {
          const ml = chart.addSeries(LineSeries, {
            color:            '#2196F3',
            lineWidth:        1.5,
            title:            'MACD',
            priceLineVisible: false,
            lastValueVisible: true,
          }, MACD_PANE)
          ml.setData(macdLine)
        }

        if (macdSignal?.length) {
          const sl = chart.addSeries(LineSeries, {
            color:            '#FF9800',
            lineWidth:        1.5,
            title:            'Signal',
            priceLineVisible: false,
            lastValueVisible: true,
          }, MACD_PANE)
          sl.setData(macdSignal)
        }
      }

      // ── Pane 2: Ratio vs benchmark ─────────────────────────────────────
      if (hasRatio) {
        addLine(ratioLine,   RATIO_STYLE.line,   RATIO_PANE)
        addLine(ratioEma20,  RATIO_STYLE.ema20,  RATIO_PANE)
        addLine(ratioEma150, RATIO_STYLE.ema150, RATIO_PANE)
      }

      // ── Pane sizing via STRETCH FACTORS (v5 proportional API) ──────────
      // New panes default to a tiny stretch factor, which is why the MACD/Ratio
      // panes were squished. Setting explicit relative weights distributes the
      // height proportionally — bigger MACD so it's clearly readable.
      const panes = chart.panes()
      const nPanes = panes.length
      if (nPanes >= 3 && hasMacd && hasRatio) {
        panes[0].setStretchFactor(46)  // Price
        panes[1].setStretchFactor(30)  // MACD — large
        panes[2].setStretchFactor(24)  // Ratio
      } else if (nPanes >= 2 && (hasMacd || hasRatio)) {
        panes[0].setStretchFactor(65)
        panes[1].setStretchFactor(35)
      }

      // fitContent must run AFTER pane-height mutations are committed to the DOM.
      // One rAF is not enough — use two consecutive frames so the layout engine
      // has fully applied the pane sizes before we ask for a time-scale fit.
      const fit = () => { try { chart?.timeScale().fitContent() } catch { /* ignore */ } }
      fit()
      const raf1 = requestAnimationFrame(() => {
        fit()
        const raf2 = requestAnimationFrame(fit)
        return raf2
      })

      const ro = new ResizeObserver(() => {
        if (containerRef.current && chart) {
          chart.applyOptions({ width: containerRef.current.clientWidth })
          fit()
        }
      })
      ro.observe(containerRef.current)

      return () => {
        cancelAnimationFrame(raf1)
        ro.disconnect()
        chart.remove()
      }
    } catch (err) {
      console.error('CandleChart error:', err)
    }
  }, [candles, ema20, ema50, ema150,
      macdLine, macdSignal, macdHistogram,
      ratioLine, ratioEma20, ratioEma150, height, hasMacd, hasRatio])

  return <div ref={containerRef} style={{ width: '100%', height }} />
}
