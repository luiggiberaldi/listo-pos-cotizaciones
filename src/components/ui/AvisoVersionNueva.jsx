// src/components/ui/AvisoVersionNueva.jsx
// Aviso discreto cuando hay una versión nueva instalada pero la recarga se aplazó
// porque hay un operador con sesión (main.jsx). Se aplica sola al cerrar sesión.
import { useEffect, useState } from 'react'

export const EVENTO_VERSION_NUEVA = 'app:version-nueva'

export default function AvisoVersionNueva() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const mostrar = () => setVisible(true)
    window.addEventListener(EVENTO_VERSION_NUEVA, mostrar)
    return () => window.removeEventListener(EVENTO_VERSION_NUEVA, mostrar)
  }, [])

  if (!visible) return null
  return (
    <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] flex items-center gap-3 rounded-xl bg-slate-800 text-white text-sm px-4 py-2.5 shadow-lg">
      <span>Hay una versión nueva. Se aplicará cuando cierres sesión.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-lg bg-white/15 hover:bg-white/25 px-2.5 py-1 font-semibold"
        title="Recarga ahora y tendrás que volver a poner tu PIN"
      >
        Actualizar ahora
      </button>
      <button type="button" onClick={() => setVisible(false)} aria-label="Cerrar aviso" className="shrink-0 text-white/70 hover:text-white">✕</button>
    </div>
  )
}
