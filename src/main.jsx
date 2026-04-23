// src/main.jsx
// Punto de entrada de la aplicación
// Los providers (QueryClient, BrowserRouter) viven en App.jsx
// para que AppRoutes pueda usar useEffect allí mismo
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './modo-accesible.css'

// Aplicar modo accesible antes del render para evitar flash visual
if (localStorage.getItem('modo-accesible') === '1') {
  document.documentElement.classList.add('modo-accesible')
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Registrar Service Worker para soporte offline (precache de assets)
if ('serviceWorker' in navigator) {
  // Recargar cuando un nuevo SW tome el control (nueva versión desplegada)
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true
      window.location.reload()
    }
  })

  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    // Forzar chequeo de actualización inmediato y periódico
    reg.update()
    setInterval(() => reg.update(), 60 * 1000)
  })
}
