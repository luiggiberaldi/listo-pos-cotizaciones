// src/hooks/useDespachos.js
// Queries y mutations para notas de despacho
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders, chunkIds } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { authFetch } from '../services/authFetch'
import { broadcastEntidad } from '../services/supabase/realtimeBus'
import { notifyDespachoCreado, notifyStockBajo, notifyDespachoEnRuta, notifyDespachoEntregado, notifyDespachoCancelado } from '../services/notificationService'
import { showToast } from '../components/ui/Toast'
import { sendPushNotification } from './usePushNotifications'

export const DESPACHOS_KEY = ['despachos']

// ─── Lista de despachos ─────────────────────────────────────────────────────
export function useDespachos({ estado = '', veTodos: veTodosParam = false, busqueda = '', esHoy = false } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esLogistica = perfil?.rol === 'logistica'
  const esAdmin = perfil?.rol === 'administracion'
  const esDesarrollador = perfil?.rol === 'desarrollador'
  // Admin siempre ve todos; logística siempre ve todos; supervisor/dev solo si toggle activo
  const veTodos = esAdmin || esLogistica || ((esSupervisor || esDesarrollador) && veTodosParam)

  return useQuery({
    queryKey: [...DESPACHOS_KEY, estado, veTodos, perfil?.id, busqueda, esHoy],
    queryFn: async () => {
      let matchedIds = null

      if (busqueda && busqueda.trim()) {
        const q = busqueda.trim()
        const promises = []

        // 1. Search by dispatch/quotation numbers
        const numberClean = q.replace(/^(des|cot|dsp|odc)[.\s-]*/i, '').replace(/^0+/g, '')
        const isNum = numberClean && !isNaN(numberClean)
        const numVal = isNum ? parseInt(numberClean, 10) : null

        if (isNum) {
          promises.push(
            supabase.from('notas_despacho').select('id').eq('numero', numVal).then(r => r.data?.map(d => d.id) || [])
          )
          promises.push(
            supabase.from('cotizaciones').select('id').eq('numero', numVal).then(async r => {
              const cotIds = r.data?.map(c => c.id) || []
              if (cotIds.length === 0) return []
              const despRes = await supabase.from('notas_despacho').select('id').in('cotizacion_id', cotIds)
              return despRes.data?.map(d => d.id) || []
            })
          )
        }

        // 2. Search by client via lookup
        const sessionRes = await supabase.auth.getSession()
        const session = sessionRes.data?.session
        if (session?.access_token) {
          promises.push(
            fetch(apiUrl(`/api/clientes?busqueda=${encodeURIComponent(q)}`), {
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }
            })
            .then(r => r.ok ? r.json() : [])
            .then(async clients => {
              const clientIds = clients.map(c => c.id).filter(Boolean)
              if (clientIds.length === 0) return []
              const despRes = await supabase.from('notas_despacho')
                .select('id')
                .or(`cliente_id.in.(${clientIds.join(',')}),cliente_factura_id.in.(${clientIds.join(',')})`)
              return despRes.data?.map(d => d.id) || []
            })
            .catch(err => {
              console.error('Error fetching clients in search:', err)
              return []
            })
          )
        }

        // 3. Search by vendor
        promises.push(
          supabase.from('usuarios').select('id').ilike('nombre', `%${q}%`).then(async r => {
            const uIds = r.data?.map(u => u.id) || []
            if (uIds.length === 0) return []
            const despRes = await supabase.from('notas_despacho').select('id').in('vendedor_id', uIds)
            return despRes.data?.map(d => d.id) || []
          })
        )

        // 4. Match in notes/references
        promises.push(
          supabase.from('notas_despacho').select('id').or(`notas.ilike.%${q}%,referencia_pago.ilike.%${q}%`).then(r => r.data?.map(d => d.id) || [])
        )

        const results = await Promise.all(promises)
        matchedIds = [...new Set(results.flat())]
      }

      if (matchedIds !== null && matchedIds.length === 0) {
        return []
      }

      let query = supabase
        .from('notas_despacho')
        .select(`
          id, numero, cotizacion_id, estado, tiene_prestamos, tiene_devoluciones,
          total_usd, flete_usd, corte_usd, descuento_total_usd,
          flete_neto_transportista_usd, flete_pct_aplicado, flete_pagado,
          flete_comisionable, flete_estado_destino_snapshot, flete_regla_aplicada,
          direccion_envio_estado, direccion_envio_ciudad, direccion_envio_direccion, notas, forma_pago,
          referencia_pago, forma_pago_cliente,
          creado_en, actualizado_en, despachada_en, entregada_en, aprobado_por_nombre,
          cliente_id, cliente_factura_id, vendedor_id, transportista_id,
          items_count:notas_despacho_items(count),
          transportista:transportistas!notas_despacho_transportista_id_fkey(id, nombre, rif, telefono, color, color_batea, vehiculo, placa_chuto, placa_batea, es_local),
          cliente:clientes!notas_despacho_cliente_id_fkey(id, nombre, estado, ciudad),
          cotizacion:cotizaciones!notas_despacho_cotizacion_id_fkey(id, numero, version),
          seguimiento:seguimiento_operativo(id, prioridad, fijada)
        `)
        .order(estado ? 'actualizado_en' : 'numero', { ascending: false })

      if (matchedIds !== null) {
        // Evitar URLs gigantes; para búsquedas con muchos resultados el filtro
        // se divide en lotes y se resuelve antes de la consulta enriquecida.
        const matchedChunks = chunkIds(matchedIds, 50)
        if (matchedChunks.length === 0) return []
        if (matchedChunks.length > 1) {
          const results = await Promise.all(matchedChunks.map(chunk =>
            supabase.from('notas_despacho').select('id').in('id', chunk)
          ))
          const ids = results.flatMap(r => r.error ? [] : (r.data || []).map(row => row.id))
          if (ids.length === 0) return []
          query = query.in('id', ids.slice(0, 200))
        } else {
          query = query.in('id', matchedChunks[0])
        }
      }

      if (esHoy) {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        const end = new Date()
        end.setHours(23, 59, 59, 999)
        query = query.gte('creado_en', start.toISOString()).lte('creado_en', end.toISOString())
      }

      if (matchedIds === null && !esHoy) {
        query = query.limit(200)
      }

      if (estado) query = query.eq('estado', estado)

      // Logística solo ve despachos aprobados (despachada/entregada), NO pendientes
      if (esLogistica && !estado) query = query.in('estado', ['despachada', 'entregada'])

      // Vendedores solo ven sus propios despachos; logística/admin/supervisor ven todos
      if (!veTodos) query = query.eq('vendedor_id', perfil.id)

      const { data, error } = await query
      if (error) throw error
      if (!data?.length) return []

      // Fetch clientes via Worker API (service key, bypasses RLS)
      const clienteIds = [...new Set([
        ...data.map(r => r.cliente_id),
        ...data.map(r => r.cliente_factura_id),
      ].filter(Boolean))]
      // Siempre cargar vendedores por separado (el join puede fallar por RLS)
      const vendedorIds = [...new Set(data.map(r => r.vendedor_id).filter(Boolean))]

      const session = (await supabase.auth.getSession()).data.session

      const VENDEDOR_COLS = 'id, nombre, color, telefono, rol, markup_pct, comision_pct, comision_pct_cabilla, es_externo, codigo'

      // 1. Cargar clientes y vendedores de los despachos EN PARALELO
      //    (antes era en serie: 3 viajes → ahora 1 tanda + 1 condicional)
      //    El lookup de clientes degrada a [] si falla: la lista se muestra
      //    con "cliente: —" en vez de fallar completa.
      const [clientesData, vendedoresDespRes] = await Promise.all([
        clienteIds.length
          ? fetch(apiUrl('/api/clientes/lookup'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session?.access_token}`,
                'X-Operator-Id': perfil?.id || '',
              },
              body: JSON.stringify({ ids: clienteIds }),
            }).then(r => r.ok ? r.json() : []).catch(() => [])
          : Promise.resolve([]),
        vendedorIds.length
          ? supabase.from('usuarios').select(VENDEDOR_COLS).in('id', vendedorIds)
          : Promise.resolve({ data: [] }),
      ])

      const vendedoresMap = Object.fromEntries(
        (vendedoresDespRes.error ? [] : vendedoresDespRes.data ?? []).map(v => [v.id, v])
      )

      // 2. Vendedores adicionales referenciados por los clientes (solo los que falten)
      const vendedorIdsFaltantes = [...new Set(
        clientesData.map(c => c.vendedor_id || c.vendedor?.id).filter(Boolean)
      )].filter(id => !vendedoresMap[id])

      if (vendedorIdsFaltantes.length) {
        const extraRes = await supabase.from('usuarios').select(VENDEDOR_COLS).in('id', vendedorIdsFaltantes)
        for (const v of (extraRes.error ? [] : extraRes.data ?? [])) vendedoresMap[v.id] = v
      }

      // 3. Hidratar el vendedor dentro de cada cliente
      const clientesMap = Object.fromEntries((clientesData ?? []).map(c => {
        const vId = c.vendedor_id || c.vendedor?.id
        if (vId) {
          c.vendedor = vendedoresMap[vId] || c.vendedor
        }
        return [c.id, c]
      }))

      return data.map(r => ({
        ...r,
        cliente: clientesMap[r.cliente_id] ?? null,
        cliente_factura: clientesMap[r.cliente_factura_id] ?? null,
        vendedor: vendedoresMap[r.vendedor_id] ?? r.vendedor ?? null,
      }))
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 5,
    // gcTime heredado del global (24h) — debe ser >= maxAge del persister
    // para que los despachos sobrevivan en el caché offline de IndexedDB
  })
}

// ─── Chequeo de stock/ítems por lote para las tarjetas ──────────────────────
// Antes cada DespachoCard pendiente/despachada hacía 2 queries propias al
// montar (N+1: 50 tarjetas = 100 queries). Ahora la vista hace 2 tandas
// para TODOS los despachos visibles y reparte los datos por props.
export function useStockCheckDespachos(despachos = [], { enabled = true } = {}) {
  const ids = despachos
    .filter(d => ['pendiente', 'despachada'].includes(d.estado))
    .map(d => d.id)
  const idsKey = [...ids].sort().join(',')

  return useQuery({
    queryKey: [...DESPACHOS_KEY, 'stock-check', idsKey],
    queryFn: async () => {
      if (!ids.length) return { itemsPorDespacho: {}, prodsMap: {} }

      // 1. Items de todos los despachos visibles (lotes de 100 en paralelo)
      const batches = []
      for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100))
      const results = await Promise.all(batches.map(batch =>
        supabase
          .from('notas_despacho_items')
          .select('despacho_id, id, producto_id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, orden, es_prestamo, productos(categoria)')
          .in('despacho_id', batch)
          .order('orden')
      ))
      const items = []
      for (const r of results) {
        if (r.error) throw r.error
        items.push(...(r.data ?? []))
      }
      const itemsPorDespacho = {}
      for (const it of items) {
        const mapped = { ...it, categoria: it.productos?.categoria || '' }
        if (!itemsPorDespacho[it.despacho_id]) itemsPorDespacho[it.despacho_id] = []
        itemsPorDespacho[it.despacho_id].push(mapped)
      }

      // 2. Stock actual de todos los productos referenciados
      const pids = [...new Set(items.map(it => it.producto_id).filter(Boolean))]
      const prodsMap = {}
      if (pids.length) {
        const pBatches = []
        for (let i = 0; i < pids.length; i += 200) pBatches.push(pids.slice(i, i + 200))
        const pResults = await Promise.all(pBatches.map(batch =>
          supabase.from('productos').select('id, stock_actual, categoria').in('id', batch)
        ))
        for (const r of pResults) {
          if (r.error) throw r.error
          for (const p of (r.data ?? [])) prodsMap[p.id] = p
        }
      }

      return { itemsPorDespacho, prodsMap }
    },
    enabled: enabled && ids.length > 0,
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
  })
}

// ─── Crear nota de despacho (via Worker API) ───────────────────────────────
export function useCrearDespacho() {
  const qc = useQueryClient()
  const perfil = useAuthStore.getState().perfil
  const rol = perfil?.rol
  const usuarioNombre = perfil?.nombre ?? 'usuario'

  return useMutation({
    mutationFn: async ({ cotizacionId, notas = null, formaPago = null, transportistaId = null, fleteUsd = 0, corteUsd = 0, referenciaPago = null, formaPagoCliente = null, clienteFacturaId = null, direccionEnvioDireccion = null, direccionEnvioCiudad = null, direccionEnvioEstado = null, numeroCotizacion, clienteNombre }) => {
      const res = await authFetch('/api/despachos/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cotizacionId, notas: notas || null, formaPago: formaPago || null, transportistaId: transportistaId || null, fleteUsd: Number(fleteUsd) || 0, corteUsd: Number(corteUsd) || 0, referenciaPago: referenciaPago || null, formaPagoCliente: formaPagoCliente || null, clienteFacturaId: clienteFacturaId || null, direccionEnvioDireccion: direccionEnvioDireccion || null, direccionEnvioCiudad: direccionEnvioCiudad || null, direccionEnvioEstado: direccionEnvioEstado || null }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al crear despacho')

      const despachoId = result.id

      return {
        id: despachoId,
        numeroCotizacion: result.numeroCotizacion || numeroCotizacion,
        clienteNombre: result.clienteNombre || clienteNombre
      }
    },
    onSuccess: async (data, variables) => {
      const id = data?.id
      if (!id) return

      const numCot = data?.numeroCotizacion || variables?.numeroCotizacion
      const cliNom = data?.clienteNombre || variables?.clienteNombre

      const displayNum = numCot ? (typeof numCot === 'number' ? String(numCot).padStart(5, '0') : String(numCot).replace(/^(COT-|DES-)/i, '')) : '—'
      const displayCliente = cliNom || 'cliente'

      let esCod = false
      try {
        const fp = typeof variables?.formaPago === 'string' ? JSON.parse(variables.formaPago) : (variables?.formaPago || [])
        if (Array.isArray(fp)) {
          esCod = fp.some(f => f.metodo === 'Cobro a destino')
        }
      } catch { /* forma de pago opcional; conservar el valor por defecto */ }

      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['inventario'], exact: false })
      qc.invalidateQueries({ queryKey: ['comisiones'], exact: false })
      qc.invalidateQueries({ queryKey: ['cotizaciones'], exact: false })
      qc.invalidateQueries({ queryKey: ['stock_comprometido'] })
      qc.invalidateQueries({ queryKey: ['cuentas-cobrar'] })
      broadcastEntidad(['despachos', 'inventario', 'comisiones', 'cotizaciones', 'cuentas'])
      showToast('Nota de despacho creada', 'success')
      notifyDespachoCreado(displayNum, displayCliente, usuarioNombre, rol, perfil?.id, esCod)
      sendPushNotification({
        title: `🚚 Orden de Despacho Creada${esCod ? ' [COD]' : ''}`,
        message: `Despacho para cotización #${displayNum} — ${displayCliente}${esCod ? ' (Cobro a Destino)' : ''}`,
        tag: `despacho-${displayNum}`,
        url: '/despachos',
        targetRole: 'supervisor,administracion,jefe',
      })
    },
  })
}

// ─── Actualizar estado de despacho (via Worker API) ────────────────────────
const ESTADO_LABELS = { pendiente: 'Pendiente', despachada: 'Despachada', entregada: 'Entregada', anulada: 'Anulada' }

export function useActualizarEstadoDespacho() {
  const qc = useQueryClient()
  const perfil = useAuthStore.getState().perfil
  const rol = perfil?.rol
  const usuarioNombre = perfil?.nombre ?? 'usuario'

  return useMutation({
    mutationFn: async ({ despachoId, nuevoEstado, numeroCotizacion, clienteNombre, vendedorId = null, motivoDevolucion = null, motivoAnulacion = null, tasaBcv = null }) => {
      const body = { despachoId, nuevoEstado }
      if (motivoDevolucion) body.motivo_devolucion = motivoDevolucion
      if (motivoAnulacion) body.motivo_anulacion = motivoAnulacion
      if (tasaBcv && Number(tasaBcv) > 0) body.tasaBcv = Number(tasaBcv)

      const res = await authFetch('/api/despachos/estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al cambiar estado del despacho')
      return { nuevoEstado, numeroCotizacion, clienteNombre, vendedorId }
    },
    // Optimistic update: reflect state change immediately in UI
    onMutate: async ({ despachoId, nuevoEstado }) => {
      await qc.cancelQueries({ queryKey: DESPACHOS_KEY })
      const previousQueries = qc.getQueriesData({ queryKey: DESPACHOS_KEY })
      qc.setQueriesData({ queryKey: DESPACHOS_KEY }, (old) => {
        if (!Array.isArray(old)) return old
        return old.map(d => d.id === despachoId ? {
          ...d,
          estado: nuevoEstado,
          ...(nuevoEstado === 'despachada' ? { despachada_en: new Date().toISOString() } : {}),
          ...(nuevoEstado === 'entregada' ? { despachada_en: d.despachada_en || new Date().toISOString(), entregada_en: new Date().toISOString() } : {}),
        } : d)
      })
      return { previousQueries }
    },
    onError: (error, _vars, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([key, data]) => qc.setQueryData(key, data))
      }
      showToast(error.message || 'Error al cambiar estado del despacho', 'error')
    },
    onSuccess: ({ nuevoEstado, numeroCotizacion, clienteNombre, vendedorId }) => {
      showToast(`Despacho marcado como ${ESTADO_LABELS[nuevoEstado] || nuevoEstado}`, 'success')

      const num = numeroCotizacion ? (typeof numeroCotizacion === 'number' ? String(numeroCotizacion).padStart(5, '0') : String(numeroCotizacion).replace(/^(COT-|DES-)/i, '')) : '—'
      const cliente = clienteNombre || 'cliente'

      if (nuevoEstado === 'despachada') {
        notifyDespachoEnRuta(num, cliente, usuarioNombre, rol, perfil?.id, vendedorId)
        sendPushNotification({
          title: '🚚 Despacho en Ruta',
          message: `Despacho #${num} — ${cliente} despachado por ${usuarioNombre}`,
          tag: `despacho-ruta-${num}`,
          url: '/despachos',
          targetRole: 'vendedor,logistica',
        })
      } else if (nuevoEstado === 'entregada') {
        notifyDespachoEntregado(num, cliente, usuarioNombre, rol, perfil?.id, vendedorId)
        sendPushNotification({
          title: '✅ Despacho Entregado',
          message: `Despacho #${num} — ${cliente} entregado (marcado por ${usuarioNombre})`,
          tag: `despacho-entregado-${num}`,
          url: '/despachos',
          targetRole: 'vendedor',
        })
      } else if (nuevoEstado === 'anulada') {
        notifyDespachoCancelado(num, cliente, usuarioNombre, rol, perfil?.id)
        sendPushNotification({
          title: '❌ Despacho Cancelado',
          message: `Despacho #${num} — ${cliente} cancelado por ${usuarioNombre}`,
          tag: `despacho-cancelado-${num}`,
          url: '/despachos',
        })
      }
    },
    onSettled: () => {
      // Pequeño delay para que el Worker haya comprometido el cambio de estado
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
        qc.invalidateQueries({ queryKey: ['inventario'], exact: false })
        qc.invalidateQueries({ queryKey: ['comisiones'], exact: false })
        qc.invalidateQueries({ queryKey: ['cotizaciones'], exact: false })
        qc.invalidateQueries({ queryKey: ['stock_comprometido'] })
        qc.invalidateQueries({ queryKey: ['reporte-ventas'] })
        qc.invalidateQueries({ queryKey: ['dashboard_metrics'] })
        qc.invalidateQueries({ queryKey: ['clientes'], exact: false })
        qc.invalidateQueries({ queryKey: ['cuentas-cobrar'], exact: false })
        broadcastEntidad(['despachos', 'inventario', 'comisiones', 'cotizaciones', 'clientes', 'cuentas'])
      }, 400)
    },
  })
}

// ─── Editar despacho pendiente (pago, transportista, notas) ─────────────────
export function useEditarDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ despachoId, formaPago, formaPagoCliente, referenciaPago, transportistaId, fleteUsd, corteUsd, notas, clienteId, direccionEnvioDireccion, direccionEnvioCiudad, direccionEnvioEstado }) => {
      const res = await authFetch('/api/despachos/editar-pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ despachoId, formaPago, formaPagoCliente, referenciaPago, transportistaId, fleteUsd, corteUsd, notas, clienteId, direccionEnvioDireccion, direccionEnvioCiudad, direccionEnvioEstado }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al editar despacho')
      return result
    },
    onSuccess: async () => {
      showToast('Despacho actualizado', 'success')
      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['stock_comprometido'] })
      qc.invalidateQueries({ queryKey: ['reporte-ventas'] })
      qc.invalidateQueries({ queryKey: ['dashboard_metrics'] })
      qc.invalidateQueries({ queryKey: ['clientes'], exact: false })
      qc.invalidateQueries({ queryKey: ['cuentas-cobrar'], exact: false })
      broadcastEntidad(['despachos', 'clientes', 'cuentas'])
    },
    onError: (error) => {
      showToast(error.message || 'Error al editar despacho', 'error')
    },
  })
}

// ─── Editar ítems de despacho a profundidad (administracion) ────────────────
export function useEditarItemsDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ despachoId, items, pagos }) => {
      console.group('[DEEP_EDIT][NETWORK_TRACE]')
      console.log('Request body at mutation boundary', { despachoId, itemCount: Array.isArray(items) ? items.length : null, items, pagos })
      const body = JSON.stringify({ despachoId, items, pagos })
      console.log('Serialized request body', JSON.parse(body))
      const res = await authFetch('/api/despachos/editar-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al editar ítems del despacho')
      return result
    },
    onSuccess: async () => {
      showToast('Ítems del despacho actualizados con éxito', 'success', 5000)
      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['inventario'], exact: false })
      qc.invalidateQueries({ queryKey: ['stock_comprometido'] })
      qc.invalidateQueries({ queryKey: ['dashboard_metrics'] })
      qc.invalidateQueries({ queryKey: ['clientes'], exact: false })
      qc.invalidateQueries({ queryKey: ['cuentas-cobrar'], exact: false })
      broadcastEntidad(['despachos', 'inventario', 'clientes', 'cuentas'])
    },
    onError: (error) => {
      showToast(error.message || 'Error al editar ítems', 'error')
    },
  })
}

// ─── Reciclar despacho anulado → cotización borrador (via Worker API) ────────
export function useReciclarDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (despachoId) => {
      const res = await authFetch('/api/despachos/reciclar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ despachoId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al reciclar despacho')
      return result.id
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['cotizaciones'], exact: false })
      broadcastEntidad(['despachos', 'cotizaciones'])
    },
  })
}

// ─── Devolución parcial de despacho entregado (administracion/logistica) ────
export function useDevolucionParcialDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ despachoId, items, motivo, generarReemplazo, exchangeItems, pagosDiferencia }) => {
      const res = await authFetch('/api/despachos/devolucion-parcial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ despachoId, items, motivo, generarReemplazo, exchangeItems, pagosDiferencia: Array.isArray(pagosDiferencia) ? pagosDiferencia : [] }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al registrar devolución parcial')
      return result
    },
    onSuccess: async () => {
      showToast('Devolución parcial registrada con éxito', 'success')
      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['inventario'], exact: false })
      qc.invalidateQueries({ queryKey: ['clientes'], exact: false })
      qc.invalidateQueries({ queryKey: ['cuentas-cobrar'], exact: false })
      qc.invalidateQueries({ queryKey: ['cotizaciones'], exact: false })
      qc.invalidateQueries({ queryKey: ['dashboard_metrics'] })
      qc.invalidateQueries({ queryKey: ['reporte-ventas'] })
      broadcastEntidad(['despachos', 'inventario', 'clientes', 'cuentas', 'cotizaciones'])
    },
    onError: (error) => {
      showToast(error.message || 'Error al registrar devolución', 'error')
    },
  })
}

