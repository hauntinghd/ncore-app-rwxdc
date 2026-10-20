import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportRuntimeError } from '../../lib/runtimeTelemetry';

interface DataBoundaryProps {
  children: ReactNode;
  label?: string;
  onRetry?: () => void;
  fallback?: (reset: () => void, error: Error) => ReactNode;
}

interface DataBoundaryState {
  error: Error | null;
}

export class DataBoundary extends Component<DataBoundaryProps, DataBoundaryState> {
  state: DataBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): DataBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    reportRuntimeError('data_boundary_caught', error, {
      label: this.props.label || 'unknown',
      component_stack: info.componentStack,
    }, { sampleRate: 1 });
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.reset, this.state.error);
      return (
        <div className="flex flex-col items-center justify-center text-center py-10 px-6">
          <div className="relative w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
            <AlertTriangle size={22} className="text-red-300" />
          </div>
          <h3 className="text-base font-semibold text-surface-100">Something went sideways loading this.</h3>
          <p className="mt-1.5 text-sm text-surface-400 max-w-sm">
            {this.props.label ? `We couldn't load ${this.props.label}.` : 'The screen hit an error while loading.'}
            {' '}Give it a retry — usually a transient hiccup.
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-5 nyptid-btn-secondary inline-flex items-center gap-2 !px-3 !py-1.5 !text-xs"
          >
            <RefreshCw size={12} />
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
