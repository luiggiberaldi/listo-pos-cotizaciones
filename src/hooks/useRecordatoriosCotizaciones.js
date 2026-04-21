// src/hooks/useRecordatoriosCotizaciones.js
// Recordatorios proactivos de cotizaciones (estilo Buildertrend):
//   1. Cotización enviada hace ≥ DIAS_SIN_RESPUESTA sin respuesta → alerta al vendedor/supervisor
//   2. Cotización próxima a vencer (≤ DIAS_AVISO_VENCIMIENTO días)  → alerta
//
// Corre una vez al montar el layout y luego cada CHECK_INTERVAL_MS.
// Usa cooldowns en localStorage para no repetir la misma alerta en < 24 h.

import { useEffect, useRef } from 'react'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import {
  notifyCotizacionSinRespuesta,
  notifyCotizacionPorVencer,
} from '../services/notificationService'

const DIAS_SIN_RESPUESTA    = 3   // días sin respuesta para alertar
const DIAS_AVISO_VENCIMIENTO = 2  // días restantes para alertar
const CHECK_INTERVAL_MS     = 60 * 60 * 1000 // cada 1 hora

export function useRecordatoriosCotizaciones() {
  const { perfil } = useAuthStore()
  const timerRef   = useRef(null)

  useEffect(() => {
    if (!perfil) return

    async function check() {
      const esSupervisor = perfil.rol === 'supervisor'
      const hoy = new Date()
      hoy.setHours(0, 0, 0, 0)

      // ── 1. Cotizaciones enviadas sin respuesta ────────────────────────────
      const umbralesSinRespuesta = new Date(hoy)
      umbralesSinRespuesta.setDate(umbralesSinRespuesta.getDate() - DIAS_SIN_RESPUESTA)

      let sinRespuestaQuery = supabase
        .from('cotizaciones')
        .select(`
          numero, enviada_en,
          cliente:clientes!cotizaciones_cliente_id_fkey(nombre),
          vendedor:usuarios!cotizaciones_vendedor_id_fkey(nombre)
        `)
        .eq('estado', 'enviada')
        .lte('enviada_en', umbralesSinRespuesta.toISOString())
        .not('enviada_en', 'is', null)
        .order('enviada_en', { ascending: true })
        .limit(50)

      if (!esSupervisor) {
        sinRespuestaQuery = sinRespuestaQuery.eq('vendedor_id', perfil.id)
      }

      const { data: sinRespuesta } = await sinRespuestaQuery
      if (sinRespuesta?.length) {
        for (const c of sinRespuesta) {
          const dias = Math.floor(
            (Date.now() - new Date(c.enviada_en).getTime()) / (1000 * 60 * 60 * 24)
          )
          notifyCotizacionSinRespuesta(
            c.numero,
            c.cliente?.nombre ?? '—',
            dias,
            esSupervisor ? c.vendedor?.nombre : null,
          )
        }
      }

      // ── 2. Cotizaciones por vencer ────────────────────────────────────────
      const limiteVencimiento = new Date(hoy)
      limiteVencimiento.setDate(limiteVencimiento.getDate() + DIAS_AVISO_VENCIMIENTO)

      let porVencerQuery = supabase
        .from('cotizaciones')
        .select(`
          numero, valida_hasta,
          cliente:clientes!cotizaciones_cliente_id_fkey(nombre)
        `)
        .in('estado', ['enviada', 'borrador'])
        .gte('valida_hasta', hoy.toISOString().slice(0, 10))
        .lte('valida_hasta', limiteVencimiento.toISOString().slice(0, 10))
        .order('valida_hasta', { ascending: true })
        .limit(50)

      if (!esSupervisor) {
        porVencerQuery = porVencerQuery.eq('vendedor_id', perfil.id)
      }

      const { data: porVencer } = await porVencerQuery
      if (porVencer?.length) {
        for (const c of porVencer) {
          const vence = new Date(c.valida_hasta)
          vence.setHours(0, 0, 0, 0)
          const diasRestantes = Math.round((vence - hoy) / (1000 * 60 * 60 * 24))
          notifyCotizacionPorVencer(
            c.numero,
            c.cliente?.nombre ?? '—',
            diasRestantes,
          )
        }
      }
    }

    // Primera ejecución diferida para no bloquear el render inicial
    const initialTimer = setTimeout(check, 3000)
    timerRef.current   = setInterval(check, CHECK_INTERVAL_MS)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(timerRef.current)
    }
  }, [perfil])
}
