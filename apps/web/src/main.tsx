import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './locales/i18n.js';
import App from './App.js';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
