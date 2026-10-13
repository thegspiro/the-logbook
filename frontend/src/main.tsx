import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { setupGlobalErrorHandlers } from './services/errorReporting';
import { registerServiceWorker } from './utils/serviceWorkerUpdate';
import { installSkipLinkFocus } from './utils/skipLink';
import './styles/index.css';

// Installed before render so failures during the initial mount — and any
// thrown outside React's render cycle, which ErrorBoundary cannot see — are
// reported to the Error Monitoring page rather than only the browser console.
setupGlobalErrorHandlers();

registerServiceWorker();

installSkipLinkFocus();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('index.html is missing the #root element the app mounts into');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
