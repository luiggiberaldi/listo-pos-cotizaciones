// src/hooks/useRecordatoriosCotizaciones.js
// Recordatorios proactivos de cotizaciones:
//   1. Cotización enviada hace ≥ 1 hora sin respuesta → alerta al supervisor
//   2. Cotización próxima a vencer (≤ 2 días) → alerta
//
// Corre una vez al montar el layout y luego cada CHECK_INTERVAL_MS.
// Usa cooldowns en localStorage para no repetir la misma alerta.

import { useEffect, useRef } from 'react'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import {
  notifyCotizacionSinRespuesta,
  notifyCotizacionPorVencer,
} from '../services/notificationService'

const HORAS_SIN_RESPUESTA     = 1    // horas sin respuesta para alertar
const DIAS_AVISO_VENCIMIENTO  = 2    // días restantes para alertar
const CHECK_INTERVAL_MS       = 15 * 60 * 1000 // cada 15 minutos

export function useRecordatoriosCotizaciones() {
  const { perfil } = useAuthStore()
  const timerRef   = useRef(null)

  useEffect(() => {
    if (!perfil) return

    async function check() {
      const esSupervisor = perfil.rol === 'supervisor'
      const hoy = new Date()
      hoy.setHours(0, 0, 0, 0)

      // ── 1. Cotizaciones enviadas sin respuesta (≥ 1 hora) ───────────────
      const umbralSinRespuesta = new Date(Date.now() - HORAS_SIN_RESPUESTA * 60 * 60 * 1000)

      let sinRespuestaQuery = supabase
        .from('cotizaciones')
        .select(`
          numero, enviada_en,
          cliente:clientes!cotizaciones_cliente_id_fkey(nombre),
          vendedor:usuarios!cotizaciones_vendedor_id_fkey(nombre)
        `)
        .eq('estado', 'enviada')
        .lte('enviada_en', umbralSinRespuesta.toISOString())
        .not('enviada_en', 'is', null)
        .order('enviada_en', { ascending: true })
        .limit(50)

      if (!esSupervisor) {
        sinRespuestaQuery = sinRespuestaQuery.eq('vendedor_id', perfil.id)
      }

      const { data: sinRespuesta } = await sinRespuestaQuery
      if (sinRespuesta?.length) {
        for (const c of sinRespuesta) {
          const msTranscurridos = Date.now() - new Date(c.enviada_en).getTime()
          const horasTranscurridas = Math.floor(msTranscurridos / (1000 * 60 * 60))
          const dias = Math.floor(msTranscurridos / (1000 * 60 * 60 * 24))

          // Mostrar en horas si < 24h, en días si >= 24h
          const tiempoTexto = dias >= 1 ? `${dias}d` : `${horasTranscurridas}h`

          notifyCotizacionSinRespuesta(
            c.numero,
            c.cliente?.nombre ?? '—',
            tiempoTexto,
            esSupervisor ? c.vendedor?.nombre : null,
          )
        }
      }

      // ── 2. Cotizaciones por vencer ──────────────────────────────────────
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
