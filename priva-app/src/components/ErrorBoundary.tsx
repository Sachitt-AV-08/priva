import React from "react";

interface Props {
  children: React.ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so one broken view can never blank the whole
 * app (the "entire UI stopped working" failure). Shows the message + a
 * reload button instead.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label ?? "app"}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex-1 flex items-center justify-center min-h-0 p-6">
        <div className="glass-strong rounded-xl p-5 max-w-sm w-full border border-accent-red/30">
          <div className="text-sm font-semibold text-text-primary mb-1">
            {this.props.label ?? "Something"} crashed
          </div>
          <p className="text-[11px] text-text-muted mb-3 font-mono break-all">
            {String(this.state.error?.message ?? this.state.error)}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="w-full py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-all"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
