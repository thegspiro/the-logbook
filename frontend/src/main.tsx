import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { setupGlobalErrorHandlers } from './services/errorReporting';
import { registerServiceWorker } from './utils/serviceWorkerUpdate';
import './styles/index.css';

// Installed before render so failures during the initial mount — and any
// thrown outside React's render cycle, which ErrorBoundary cannot see — are
// reported to the Error Monitoring page rather than only the browser console.
setupGlobalErrorHandlers();

registerServiceWorker();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
