import { Component } from 'react';

// Catches render-time crashes so a single bad bubble can't blank the whole app (UI-08).
// Without this, an exception anywhere under <App> unmounts the tree → white screen, no recovery.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep a console trail for dev; the UI itself shows a recovery path.
    console.error('Render crash caught by ErrorBoundary:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center h-screen w-screen bg-app text-fg gap-4 px-6 text-center">
        <div className="w-12 h-12 rounded-full bg-danger/15 ring-1 ring-danger/30 grid place-items-center">
          <svg className="w-6 h-6 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-semibold">Something broke on screen</h1>
          <p className="text-sm text-fg-muted mt-1 max-w-sm">
            The conversation is saved. Reloading should bring it back where you left off.
          </p>
        </div>
        <p className="text-xs font-mono text-fg-faint max-w-md break-words">{String(this.state.error?.message || this.state.error)}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-xl bg-accent hover:brightness-110 text-accent-fg text-sm font-semibold transition-all active:scale-[0.99]"
        >
          Reload
        </button>
      </div>
    );
  }
}
