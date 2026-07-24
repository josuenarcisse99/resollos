import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

if (typeof window !== 'undefined') {
  const currentOrigin = window.location?.origin || '';
  const currentHostname = window.location?.hostname || '';
  const isLocalhost = /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(currentHostname);
  const injectedLanOrigin = typeof __RESELL_OS_LAN_ORIGIN__ === 'string' ? __RESELL_OS_LAN_ORIGIN__ : '';
  window.__RESELL_OS_LAN_ORIGIN__ = injectedLanOrigin || (!isLocalhost ? currentOrigin : '');
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
