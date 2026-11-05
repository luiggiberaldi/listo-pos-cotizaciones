// src/hooks/useAvisoCobranza.js
// Campanita de cobranza para jefe y administración: una vez al día (hora de Venezuela)
// avisa cuántas cuentas por cobrar están vencidas o vencen en los próximos días.
// El mismo resumen sale por push a las 8 a. m. desde el servidor (api/lib/cobranza.js).
import { useEffect } from 'react'
import useAuthStore from '../store/useAuthStore'
import { authFetch } from '../services/authFetch'
import { notifyCobranza } from '../services/notificationService'
import { fechaCaracas, textoCobranza } from '../utils/cobranza'

const ROLES = ['jefe', 'administracion', 'desarrollador']
const CHECK_INTERVAL_MS = 60 * 60 * 1000 // cada hora se revisa si ya cambió el día

export function useAvisoCobranza() {
  const perfil = useAuthStore(s => s.perfil)
  const operadorId = perfil?.id
  const rol = perfil?.rol

  useEffect(() => {
    if (!operadorId || !ROLES.includes(rol)) return
    const key = `construacero_aviso_cobranza_${operadorId}`
    let cancelado = false

    async function revisar() {
      const hoy = fechaCaracas()
      try { if (localStorage.getItem(key) === hoy) return } catch { /* sin almacenamiento: se revisa igual */ }
      try {
        const res = await authFetch('/api/cobranza/resumen')
        if (!res.ok || cancelado) return
        const resumen = await res.json()
        if (cancelado) return
        const texto = textoCobranza(resumen)
        if (texto) notifyCobranza({ ...texto, hoy: resumen.hoy }, rol)
        try { localStorage.setItem(key, hoy) } catch { /* silencioso */ }
      } catch { /* sin conexión: se intenta en la próxima revisión */ }
    }

    const inicial = setTimeout(revisar, 5000)
    const intervalo = setInterval(revisar, CHECK_INTERVAL_MS)
    return () => {
      cancelado = true
      clearTimeout(inicial)
      clearInterval(intervalo)
    }
  }, [operadorId, rol])
}
