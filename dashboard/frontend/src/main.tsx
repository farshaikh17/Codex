import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { SeekerApp } from './seeker/SeekerApp';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OperatorGate } from './components/OperatorGate';
import { captureShareLink, getShareView } from './api';
import './index.css';

// Plan U8: the job seeker's page is the default. The operator screens (overrides, analytics, sources, sync, clients, exports) open only with
// ?operator=1, and (gap fix, 13 Nov) only after the operator key is accepted: without it a plain sign-in prompt is shown. A client's read-only
// share link (#view=...) keeps the dashboard it was made for, without a key.
captureShareLink();
const operator = new URLSearchParams(window.location.search).get('operator') === '1';
const Root: React.FC = getShareView() ? App : operator ? () => <OperatorGate>{() => <App />}</OperatorGate> : SeekerApp;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
);
