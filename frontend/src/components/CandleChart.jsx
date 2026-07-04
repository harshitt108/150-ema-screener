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

      // ── Pane 1: MACD(12,26,9) ─────────────────────────────────────────
      // priceFormat precision:4 ensures the legend shows e.g. "-0.0423" instead
      // of "-0.04" for low-priced stocks, and avoids "0.00" for very small values.
      // We save a ref to one MACD series so DrawingOverlay can use it for
      // pane-aware coordinate conversion (drawings must anchor to MACD's Y scale,
      // not the main price scale — otherwise they drift when price zoom changes).
      let macdSeriesRef = null
      if (hasMacd) {
        const macdFmt = { type: 'price', precision: 4, minMove: 0.0001 }

        if (macdHistogram?.length) {
          const hist = chart.addSeries(HistogramSeries, {
            base:             0,
            priceLineVisible: false,
            lastValueVisible: false,
            priceFormat:      macdFmt,
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
            priceFormat:      macdFmt,
          }, MACD_PANE)
          ml.setData(macdLine)
          macdSeriesRef = ml   // ← ref for drawing overlay
        }

        if (macdSignal?.length) {
          const sl = chart.addSeries(LineSeries, {
            color:            '#FF9800',
            lineWidth:        1.5,
            title:            'Signal',
            priceLineVisible: false,
            lastValueVisible: true,
            priceFormat:      macdFmt,
          }, MACD_PANE)
          sl.setData(macdSignal)
          if (!macdSeriesRef) macdSeriesRef = sl
        }
      }

      // ── Pane 2: Ratio vs benchmark ─────────────────────────────────────
      // Ratio = stock_price / index_level (e.g. 236 / 23946 ≈ 0.00986).
      // Default 2dp rounds this to "0.00" — use 5dp so the legend shows
      // the actual value (e.g. "0.00986") and the scale is readable.
      // Save a ref to the ratio line series for pane-aware drawing (same
      // reason as macdSeriesRef — drawings must anchor to ratio's Y scale).
      let ratioSeriesRef = null
      if (hasRatio) {
        const ratioFmt = { type: 'price', precision: 5, minMove: 0.00001 }
        const addRatioLine = (data, style) => {
          if (!data?.length) return null
          const s = chart.addSeries(LineSeries, {
            color:            style.color,
            lineWidth:        style.lineWidth,
            lineStyle:        style.lineStyle ?? LineStyle.Solid,
            title:            style.title,
            priceLineVisible: false,
            lastValueVisible: true,
            priceFormat:      ratioFmt,
          }, RATIO_PANE)
          s.setData(data)
          return s
        }
        ratioSeriesRef = addRatioLine(ratioLine,   RATIO_STYLE.line)   // ← ref for drawing overlay
        addRatioLine(ratioEma20,  RATIO_STYLE.ema20)
        addRatioLine(ratioEma150, RATIO_STYLE.ema150)
      }

      // Expose chart API + per-pane series refs for the drawing overlay.
      // The overlay uses each pane's own series for coordinate conversion so
      // trendlines drawn in MACD / Ratio panes stay anchored to those scales
      // (not the main price scale, which would cause them to drift on zoom).
      onReady?.({ chart, mainSeries: candleSeries, macdSeries: macdSeriesRef, ratioSeries: ratioSeriesRef, candles })

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
