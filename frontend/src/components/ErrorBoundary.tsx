import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Catches render-time errors in any routed page and shows a recoverable screen
 * instead of a white page.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: any): State {
    return { hasError: true, message: error?.message || 'Something went wrong' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-container" style={{ textAlign: 'center', paddingTop: 100 }}>
          <h1 className="page-title">Something went wrong</h1>
          <p className="page-subtitle">{this.state.message}</p>
          <button
            className="glass-button glass-button-primary"
            style={{ marginTop: 20 }}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
