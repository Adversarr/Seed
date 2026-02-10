import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useConnectionStore } from './stores/connectionStore'
import './index.css'

// Connect to WebSocket on startup
useConnectionStore.getState().connect()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
