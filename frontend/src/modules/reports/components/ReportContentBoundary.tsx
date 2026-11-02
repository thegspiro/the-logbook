/**
 * Contains a report renderer that throws.
 *
 * Each renderer reads its report's own shape (`data.members`, `data.summary`,
 * ...) and trusts it. A body that is not that shape — a broken response, an
 * older server — threw inside the results dialog and took the whole Reports
 * page down to the app's error screen. This keeps the failure inside the
 * dialog, says the report could not be read rather than showing an empty
 * table as though it were a real result, and still reports the crash.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { errorTracker } from '../../../services/errorTracking';

interface Props {
  children: ReactNode;
  /** The report data rendered; a new result clears an earlier failure. */
  resetKey: unknown;
  /** What to show instead; the default says the report could not be read. */
  fallback?: ReactNode;
}

interface State {
  failed: boolean;
}

export class ReportContentBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    errorTracker.logError(error, {
      errorType: 'REACT_ERROR_BOUNDARY',
      additionalContext: { componentStack: (errorInfo.componentStack ?? '').slice(0, 2000) },
    });
  }

  override componentDidUpdate(prevProps: Props): void {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    if (this.state.failed) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <p role="alert" className="text-theme-alert-danger-text py-4 text-sm">
          This report&apos;s data could not be read. Close it and try generating it again.
        </p>
      );
    }
    return this.props.children;
  }
}
