import { Component, ErrorInfo, ReactNode } from 'react';

// Without this, ANY render-time error anywhere in the app (a null
// reference, a field the backend hasn't shipped yet, whatever) unmounts
// the entire React tree with zero explanation — just a blank white page.
// This is the single most confusing failure mode for a non-technical user
// to report ("it's just... white") since there's nothing to screenshot.
// Catching it here means there's always at least an error message and a
// way back, instead of a dead end.
type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error in the app:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary-page">
          <div className="error-boundary-card">
            <h1>Something went wrong</h1>
            <p>
              A part of the page hit an unexpected error instead of loading. This is usually temporary (e.g. right
              after an update is being rolled out) — reloading the page fixes it most of the time.
            </p>
            <pre className="error-boundary-detail">{this.state.error.message}</pre>
            <button type="button" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
