import { Component, ReactNode, ErrorInfo } from 'react';
import { Button } from '@/components/ui/Button';
import { reportError } from '@/lib/error-reporter';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  requestId: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      requestId: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const apiError = error as any;
    const requestId =
      apiError?.requestId ||
      apiError?.error?.requestId ||
      apiError?.details?.requestId ||
      null;

    return {
      hasError: true,
      error,
      requestId,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, {
      context: 'ErrorBoundary',
      componentStack: info.componentStack,
      requestId: this.state.requestId || undefined,
    });
    if (this.props.onError) {
      this.props.onError(error, info);
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, requestId: null });
  };

  handleGoHome = (): void => {
    this.setState({ hasError: false, error: null, requestId: null });
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const errorMessage =
        this.state.error?.message || 'An unexpected client error occurred.';
      const errorCode = (this.state.error as any)?.code;

      return (
        <div
          role="alert"
          aria-live="assertive"
          className="min-h-[50vh] flex items-center justify-center p-4 sm:p-6 lg:p-8"
        >
          <div className="max-w-md w-full bg-surface border border-error/20 shadow-lg rounded-2xl p-6 sm:p-8 text-center space-y-5">
            <div className="w-14 h-14 rounded-full bg-error/10 text-error flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
                {this.props.fallbackTitle || 'Something went wrong'}
              </h2>
              <p className="text-sm text-text-muted break-words">{errorMessage}</p>
            </div>

            {/* Diagnostics Metadata */}
            {(this.state.requestId || errorCode) && (
              <div className="p-3 bg-surface-2 rounded-lg text-xs font-mono text-left space-y-1 border border-border">
                {errorCode && (
                  <p className="text-text-muted">
                    <span className="font-semibold text-text">Error Code:</span>{' '}
                    {errorCode}
                  </p>
                )}
                {this.state.requestId && (
                  <p className="text-text-muted break-all">
                    <span className="font-semibold text-text">Request ID:</span>{' '}
                    <span className="select-all text-brand">{this.state.requestId}</span>
                  </p>
                )}
              </div>
            )}

            {/* Action Controls */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                variant="primary"
                onClick={this.handleRetry}
                className="w-full flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Try Again</span>
              </Button>
              <Button
                variant="outline"
                onClick={this.handleGoHome}
                className="w-full flex items-center justify-center gap-2"
              >
                <Home className="w-4 h-4" />
                <span>Campus Home</span>
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
