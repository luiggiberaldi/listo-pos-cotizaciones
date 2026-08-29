// src/components/ui/OfflineBanner.jsx
// Detecta estado offline y muestra banner animado que empuja el contenido hacia abajo.
// Exporta también useOffline() para que el layout pueda ajustar el padding.
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { WifiOff, Wifi } from 'lucide-react'
import { apiUrl } from '../../services/apiBase'
import { supabaseProjectRef } from '../../services/supabase/client'

// ─── Contexto ─────────────────────────────────────────────────────────────────
const OfflineCtx = createContext(false)
export const useOffline = () => useContext(OfflineCtx)

const BANNER_H = 38 // px — altura del banner (py-2 + text-sm ≈ 38px)

// ─── Verificación real de red (ping al worker, no solo navigator.onLine) ──────
async function checkRealConnectivity() {
  try {
    // GET es más compatible con Vite proxy y wrangler local que HEAD. Además,
    // el worker devuelve el project ref para detectar frontend/API cruzados.
    const res = await fetch(apiUrl('/api/ping'), {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    const backendProjectRef = res.headers.get('X-Supabase-Project-Ref')
    return {
      ok: res.ok,
      mismatch: Boolean(
        backendProjectRef && supabaseProjectRef && backendProjectRef !== supabaseProjectRef
      ),
    }
  } catch {
    return { ok: false, mismatch: false }
  }
}

// ─── Componente ───────────────────────────────────────────────────────────────
export default function OfflineBanner({ children }) {
  const [offline, setOffline] = useState(!navigator.onLine)
  const [showRestored, setShowRestored] = useState(false)
  const [projectMismatch, setProjectMismatch] = useState(false)
  const restoredTimer = useRef(null)

  const markOnline = useCallback(() => {
    setOffline(false)
    setShowRestored(true)
    clearTimeout(restoredTimer.current)
    restoredTimer.current = setTimeout(() => setShowRestored(false), 3000)
  }, [])

  const markOffline = useCallback(() => {
    setOffline(true)
    setShowRestored(false)
    clearTimeout(restoredTimer.current)
  }, [])

  useEffect(() => {
    // Sondeo periódico SOLO cuando el browser cree estar online
    async function probe() {
      // 1. Si el navegador dice que estamos offline, no hay duda
      if (!navigator.onLine) {
        if (!offline) markOffline()
        return
      }

      // 2. Si el navegador dice online, verificar servidor
      const { ok, mismatch } = await checkRealConnectivity()
      setProjectMismatch(mismatch)

      // Una API conectada a otro proyecto puede responder correctamente pero
      // mezclar datos. No lo tratamos como "sin internet": lo reportamos aparte.
      if (mismatch) return

      // Si el servidor responde y estábamos offline, restaurar
      if (ok && offline) {
        markOnline()
      }
      // Si el servidor NO responde pero el navegador dice ONLINE,
      // NO marcamos offline para no confundir al usuario con "Sin conexión".
      // Simplemente dejamos que las mutaciones fallen o usen su propia lógica de reintento.
    }

    probe()
    let interval = setInterval(probe, 30_000) // Aumentado a 30s para menos ruido

    function onOnline()  { 
      console.log('[NETWORK] Browser online')
      probe() 
    }
    function onOffline() { 
      console.log('[NETWORK] Browser offline')
      markOffline() 
    }

    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      clearInterval(interval)
      clearTimeout(restoredTimer.current)
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [offline, markOnline, markOffline])

  const visible = offline || showRestored || projectMismatch

  return (
    <OfflineCtx.Provider value={offline}>
      {/* Banner animado — NO es fixed, es sticky/flow para empujar contenido */}
      <div
        style={{
          height: visible ? BANNER_H : 0,
          overflow: 'hidden',
          transition: 'height 300ms ease',
        }}
      >
        <div
          className={`flex items-center justify-center gap-2 px-4 text-sm font-semibold text-white ${
            projectMismatch ? 'bg-red-700' : offline ? 'bg-amber-600' : 'bg-emerald-600'
          }`}
          style={{ height: BANNER_H }}
        >
          {projectMismatch ? (
            <><WifiOff size={15} /> Error de configuración — frontend y API usan bases de datos distintas</>
          ) : offline ? (
            <><WifiOff size={15} /> Sin conexión — datos en modo offline</>
          ) : (
            <><Wifi size={15} /> Conexión restaurada ✓</>
          )}
        </div>
      </div>

      {children}
    </OfflineCtx.Provider>
  )
}
