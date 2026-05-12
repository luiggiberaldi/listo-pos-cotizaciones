// src/hooks/useRecordatoriosCotizaciones.js
// Recordatorios proactivos:
//   1. Cotización enviada hace ≥ 1 hora sin respuesta → alerta
//   2. Despacho pendiente hace ≥ 4 horas sin ser despachado → alerta supervisor
//   3. Stock comprometido > 70% del real → alerta supervisor
//
// Corre una vez al montar el layout y luego cada CHECK_INTERVAL_MS.
// Usa cooldowns en localStorage para no repetir la misma alerta.

import { useEffect, useRef } from 'react'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import {
  notifyCotizacionSinRespuesta,
  notifyDespachoPendienteMucho,
  notifyCompromisoAlto,
} from '../services/notificationService'

const HORAS_SIN_RESPUESTA     = 1    // horas sin respuesta para alertar
const HORAS_DESPACHO_PENDIENTE = 4   // horas pendiente para alertar
const CHECK_INTERVAL_MS       = 15 * 60 * 1000 // cada 15 minutos
const COMPROMISO_UMBRAL       = 0.7  // 70%

export function useRecordatoriosCotizaciones() {
  const { perfil } = useAuthStore()
  const timerRef   = useRef(null)

  useEffect(() => {
    if (!perfil) return

    async function check() {
      const esSupervisor = perfil.rol === 'supervisor'

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

      // ── 2. Despachos pendientes hace ≥ 4 horas (solo supervisor) ────────
      if (esSupervisor) {
        const umbralDespacho = new Date(Date.now() - HORAS_DESPACHO_PENDIENTE * 60 * 60 * 1000)

        const { data: despachosPendientes } = await supabase
          .from('notas_despacho')
          .select(`
            id, numero, creado_en,
            cotizacion:cotizaciones!notas_despacho_cotizacion_id_fkey(numero),
            cliente_id
          `)
          .eq('estado', 'pendiente')
          .lte('creado_en', umbralDespacho.toISOString())
          .order('creado_en', { ascending: true })
          .limit(20)

        if (despachosPendientes?.length) {
          // Fetch client names
          const clienteIds = [...new Set(despachosPendientes.map(d => d.cliente_id).filter(Boolean))]
          let clientesMap = {}
          if (clienteIds.length) {
            const session = (await supabase.auth.getSession()).data.session
            if (session) {
              try {
                const { apiUrl } = await import('../services/apiBase')
                const res = await fetch(apiUrl('/api/clientes/lookup'), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                  body: JSON.stringify({ ids: clienteIds }),
                })
                if (res.ok) {
                  const clientes = await res.json()
                  clientesMap = Object.fromEntries((clientes ?? []).map(c => [c.id, c.nombre]))
                }
              } catch { /* silencioso */ }
            }
          }

          for (const d of despachosPendientes) {
            const msTranscurridos = Date.now() - new Date(d.creado_en).getTime()
            const horas = Math.floor(msTranscurridos / (1000 * 60 * 60))
            const numCot = d.cotizacion?.numero || d.numero
            const clienteNombre = clientesMap[d.cliente_id] || '—'

            notifyDespachoPendienteMucho(numCot, clienteNombre, horas)
          }
        }
      }

      // ── 3. Stock comprometido > 70% (solo supervisor) ───────────────────
      if (esSupervisor) {
        try {
          const [productosRes, comprometidoRes] = await Promise.all([
            supabase.from('productos').select('id, nombre, stock_actual, stock_minimo, unidad').eq('activo', true).gt('stock_actual', 0),
            supabase.rpc('obtener_stock_comprometido'),
          ])

          if (productosRes.data && comprometidoRes.data) {
            const comprometidoMap = Object.fromEntries(
              (comprometidoRes.data ?? []).map(c => [c.producto_id, c.total_comprometido])
            )

            const productosAltos = productosRes.data
              .map(p => {
                const comprometido = comprometidoMap[p.id] || 0
                if (comprometido <= 0 || p.stock_actual <= 0) return null
                const porcentaje = Math.round((comprometido / p.stock_actual) * 100)
                if (porcentaje < COMPROMISO_UMBRAL * 100) return null
                return { ...p, comprometido, porcentaje }
              })
              .filter(Boolean)

            if (productosAltos.length > 0) {
              notifyCompromisoAlto(productosAltos)
            }
          }
        } catch { /* silencioso */ }
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
