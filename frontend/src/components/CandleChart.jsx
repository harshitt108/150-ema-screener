import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, LineSeries, LineStyle } from 'lightweight-charts'

// Price pane EMA colours
const PRICE_EMA = {
  ema20:  { color: '#2196F3', lineWidth: 1.5, title: '20 EMA'  },
  ema50:  { color: '#7B1FA2', lineWidth: 1.5, title: '50 EMA'  },
  ema150: { color: '#212121', lineWidth: 2,   title: '150 EMA' },
}

// Ratio pane colours (matches screenshot: blue line, yellow 20 EMA, dark dashed 150 EMA)
const RATIO_STYLE = {
  line:  { color: '#2196F3', lineWidth: 1.5, title: 'Ratio'    },
  ema20: { color: '#FF9800', lineWidth: 1.5, title: '20 EMA'   },
  ema150:{ color: '#424242', lineWidth: 1.5, title: '150 EMA', lineStyle: LineStyle.Dashed },
}

const MAIN_PANE  = 0
const RATIO_PANE = 1

export default function CandleChart({
  candles, ema20, ema50, ema150,
  ratioLine, ratioEma20, ratioEma150,
  height = 500,
  onReady,          // (api: { chart, mainSeries }) => void — called after chart is created
}) {
  const containerRef = useRef(null)

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

      // ── Main price pane ────────────────────────────────────────────────
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

      // Expose the chart API for the drawing overlay
      onReady?.({ chart, mainSeries: candleSeries })

      // ── Ratio lower pane ───────────────────────────────────────────────
      if (hasRatio) {
        addLine(ratioLine,   RATIO_STYLE.line,   RATIO_PANE)
        addLine(ratioEma20,  RATIO_STYLE.ema20,  RATIO_PANE)
        addLine(ratioEma150, RATIO_STYLE.ema150, RATIO_PANE)

        // Split height: 65% price, 35% ratio
        const panes = chart.panes()
        if (panes.length >= 2) {
          panes[0].setHeight(Math.round(height * 0.65))
          panes[1].setHeight(Math.round(height * 0.35))
        }
      }

      // Fit content immediately, then again after the browser has finished
      // laying out the flex container — prevents blank left-side space.
      chart.timeScale().fitContent()
      const rafId = requestAnimationFrame(() => {
        if (chart) chart.timeScale().fitContent()
      })

      const ro = new ResizeObserver(() => {
        if (containerRef.current && chart) {
          chart.applyOptions({ width: containerRef.current.clientWidth })
          chart.timeScale().fitContent()
        }
      })
      ro.observe(containerRef.current)

      return () => {
        cancelAnimationFrame(rafId)
        ro.disconnect()
        chart.remove()
      }
    } catch (err) {
      console.error('CandleChart error:', err)
    }
  }, [candles, ema20, ema50, ema150, ratioLine, ratioEma20, ratioEma150, height, hasRatio])

  return <div ref={containerRef} style={{ width: '100%', height }} />
}
