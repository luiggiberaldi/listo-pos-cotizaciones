// src/hooks/useAvisoBuzon.js
// Aviso del Buzón para el desarrollador: cuando llega un mensaje nuevo suena la campanita y el
// menú "Buzón" muestra cuántos hay pendientes. Revisa cada minuto mientras la app esté abierta.
import { useEffect } from 'react'
import useAuthStore from '../store/useAuthStore'
import { useBuzonAdmin } from './useBuzon'
import { notifyBuzon } from '../services/notificationService'
import { mensajesPendientes, pendientesSinAviso, recordarAvisadas, textoAvisoBuzon } from '../utils/avisoBuzon'

export function useAvisoBuzon() {
  const perfil = useAuthStore(s => s.perfil)
  const operadorId = perfil?.id
  const rol = perfil?.rol
  const { data: mensajes } = useBuzonAdmin()
  const pendientes = mensajesPendientes(mensajes)

  useEffect(() => {
    if (!operadorId || rol !== 'desarrollador' || !Array.isArray(mensajes)) return
    const key = `construacero_aviso_buzon_${operadorId}`
    let avisadas = []
    try { avisadas = JSON.parse(localStorage.getItem(key) || '[]') } catch { /* sin almacenamiento */ }
    const pend = mensajesPendientes(mensajes)
    const nuevos = pendientesSinAviso(pend, avisadas)
    if (!nuevos.length) return
    const texto = textoAvisoBuzon(pend, nuevos)
    if (texto) notifyBuzon({ ...texto, cantidad: pend.length })
    try { localStorage.setItem(key, JSON.stringify(recordarAvisadas(avisadas, pend))) } catch { /* silencioso */ }
  }, [mensajes, operadorId, rol])

  return { pendientes: rol === 'desarrollador' ? pendientes.length : 0 }
}
