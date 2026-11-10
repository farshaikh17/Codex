import React from 'react';

type State = { failed: boolean };

/** Last line of defence: if a screen throws while rendering (for example an answer in a shape this build does not expect, right after an
 *  update), show a plain message with a reload button instead of a blank page. Nothing is sent anywhere. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Screen failed to render', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center bg-[#FFF8EE] p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">This page could not be shown</h1>
          <p className="mt-2 text-sm text-slate-600">
            Something unexpected happened while loading. This can happen right after an update. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700"
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
