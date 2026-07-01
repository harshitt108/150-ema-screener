import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * Catches any render error inside the chart area (chart, EMAs, MACD, drawing
 * overlay) so a single bad data point or corrupt saved drawing degrades to a
 * friendly message instead of crashing the entire app to a white screen.
 * `resetKey` (e.g. symbol:timeframe) clears the error when the user navigates
 * to a different chart.
 */
export default class ChartErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-2 bg-white text-slate-500 p-6 text-center">
          <AlertTriangle size={24} className="text-amber-500" />
          <p className="text-sm font-medium text-slate-700">Couldn't render this chart</p>
          <p className="text-xs text-slate-400 max-w-xs">
            The chart data or a saved drawing for this symbol looks malformed. Try clearing drawings, or pick another stock.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
