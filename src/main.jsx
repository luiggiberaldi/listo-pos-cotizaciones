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

// Evitar que scroll con rueda del mouse cambie valores en inputs numéricos
document.addEventListener('wheel', (e) => {
  if (e.target?.type === 'number') e.target.blur()
}, { passive: true })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Registrar Service Worker (solo para push notifications — el caché de datos está desactivado)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    } catch (err) {
      console.error('Error registrando el Service Worker', err)
    }
  })
}
