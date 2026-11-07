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
    <div
      role="status"
      // Celular: ancho completo (con margen) y por encima de la barra inferior; PC: centrado y compacto.
      className="fixed z-[60] left-3 right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] sm:bottom-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-auto sm:max-w-xl flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-slate-800 text-white text-sm px-4 py-2.5 shadow-lg"
    >
      <span className="flex-1 min-w-[12rem]">Hay una versión nueva. Se aplicará cuando cierres sesión.</span>
      <div className="flex items-center gap-2 ml-auto">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-lg bg-white/15 hover:bg-white/25 px-2.5 py-1 font-semibold"
          title="Recarga ahora y tendrás que volver a poner tu PIN"
        >
          Actualizar ahora
        </button>
        <button type="button" onClick={() => setVisible(false)} aria-label="Cerrar aviso" className="shrink-0 px-1 text-white/70 hover:text-white">✕</button>
      </div>
    </div>
  )
}
