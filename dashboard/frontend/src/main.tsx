import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { SeekerApp } from './seeker/SeekerApp';
import { ErrorBoundary } from './components/ErrorBoundary';
import { captureShareLink, getShareView } from './api';
import './index.css';

// Plan U8: the job seeker's page is the default. The operator screens (sign-in, overrides, analytics, sources, sync, clients, exports)
// open only with ?operator=1. A client's read-only share link (#view=...) keeps the dashboard it was made for.
captureShareLink();
const operator = new URLSearchParams(window.location.search).get('operator') === '1';
const Root = operator || getShareView() ? App : SeekerApp;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
);
