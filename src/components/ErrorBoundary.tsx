import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  /** Human label for the wrapped view, shown in the fallback (e.g. the instrument id). */
  label?: string
}
interface State {
  error: Error | null
  info: ErrorInfo | null
}

/**
 * Catches render / lifecycle / effect throws inside a panel so one instrument crashing shows a
 * recoverable message instead of blank-screening the whole app (there was no boundary before, so
 * any throw — e.g. a degenerate scope-settings combination feeding Plotly — tore down the entire
 * React tree). It also surfaces the actual error + component stack, which turns an intermittent
 * "blank screen, not sure what triggers it" into a concrete, copy-pasteable bug report.
 *
 * Each panel is wrapped with a key of its instrument id, so navigating to another instrument
 * remounts a fresh boundary; "Try again" remounts the crashed panel from default state.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info })
    console.error('Panel error caught by ErrorBoundary:', error, info)
  }

  private reset = () => this.setState({ error: null, info: null })

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children
    return (
      <div className="panel-error" role="alert"
        style={{ padding: 24, height: '100%', overflow: 'auto', color: 'var(--text-primary)' }}>
        <h2 style={{ color: 'var(--accent-orange, #f0a030)', marginTop: 0 }}>This panel hit an error</h2>
        <p style={{ maxWidth: 560 }}>
          Something went wrong rendering {this.props.label ?? 'this view'}. The rest of the app is
          fine — switch to another instrument and back, click Try again to reset this panel, or
          reload.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={this.reset}>Try again</button>
          <button onClick={() => location.reload()}>Reload app</button>
        </div>
        <details style={{ marginTop: 16, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, opacity: 0.85 }}>
          <summary style={{ cursor: 'pointer' }}>Error details (please copy into a bug report)</summary>
          {String(error.stack ?? error)}
          {info?.componentStack}
        </details>
      </div>
    )
  }
}
