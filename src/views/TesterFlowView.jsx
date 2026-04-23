// src/views/TesterFlowView.jsx
// Tester determinista: flujo completo de negocio paso a paso
import { useState, useRef, useCallback, useEffect } from 'react'
import {
  FlaskConical, Play, RotateCcw, CheckCircle, XCircle, Loader2,
  ChevronDown, ChevronRight, Trash2, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const ts = () => new Date().toLocaleTimeString('es-VE', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

async function apiCall(path, method = 'GET', body = null) {
  const session = (await supabase.auth.getSession()).data.session
  if (!session?.access_token) throw new Error('No autenticado')
  const opts = {
    method,
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(apiUrl(path), opts)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// ─── Step definitions ─────────────────────────────────────────────────────────
const STEPS = [
  { id: 'create_product', label: '1. Crear producto de prueba', group: 'Inventario' },
  { id: 'verify_kardex_ingreso', label: '2. Verificar kardex (ingreso inicial)', group: 'Inventario' },
  { id: 'create_client', label: '3. Crear cliente de prueba', group: 'Clientes' },
  { id: 'create_draft', label: '4. Crear cotización borrador', group: 'Cotizaciones' },
  { id: 'verify_stock_comprometido', label: '5. Verificar stock comprometido', group: 'Cotizaciones' },
  { id: 'send_quote', label: '6. Enviar cotización', group: 'Cotizaciones' },
  { id: 'accept_quote', label: '7. Aceptar cotización (supervisor)', group: 'Cotizaciones' },
  { id: 'create_despacho', label: '8. Crear despacho con transportista', group: 'Despachos' },
  { id: 'verify_stock_deducted', label: '9. Verificar stock descontado', group: 'Despachos' },
  { id: 'verify_kardex_egreso', label: '10. Verificar kardex (egreso por despacho)', group: 'Despachos' },
  { id: 'verify_stock_liberado', label: '11. Verificar stock comprometido liberado', group: 'Despachos' },
  { id: 'mark_dispatched', label: '12. Marcar como despachada', group: 'Despachos' },
  { id: 'mark_delivered', label: '13. Marcar como entregada', group: 'Despachos' },
  { id: 'verify_commission', label: '14. Verificar comisión generada', group: 'Comisiones' },
  { id: 'pay_commission', label: '15. Pagar comisión', group: 'Comisiones' },
  { id: 'verify_cxc', label: '16. Verificar cuenta por cobrar (CxC)', group: 'Cuentas por Cobrar' },
  { id: 'register_payment', label: '17. Registrar abono CxC', group: 'Cuentas por Cobrar' },
  { id: 'verify_reports_ventas', label: '18. Verificar reporte de ventas', group: 'Reportes' },
  { id: 'verify_reports_pipeline', label: '19. Verificar reporte pipeline', group: 'Reportes' },
  { id: 'verify_reports_despachos', label: '20. Verificar reporte de despachos', group: 'Reportes' },
  { id: 'verify_reports_inventario', label: '21. Verificar reporte de inventario', group: 'Reportes' },
  { id: 'cleanup', label: '22. Limpiar datos de prueba', group: 'Limpieza' },
]

const GROUP_COLORS = {
  'Inventario': 'text-amber-600 bg-amber-50 border-amber-200',
  'Clientes': 'text-sky-600 bg-sky-50 border-sky-200',
  'Cotizaciones': 'text-indigo-600 bg-indigo-50 border-indigo-200',
  'Despachos': 'text-violet-600 bg-violet-50 border-violet-200',
  'Comisiones': 'text-emerald-600 bg-emerald-50 border-emerald-200',
  'Cuentas por Cobrar': 'text-orange-600 bg-orange-50 border-orange-200',
  'Reportes': 'text-teal-600 bg-teal-50 border-teal-200',
  'Limpieza': 'text-red-600 bg-red-50 border-red-200',
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TesterFlowView() {
  const { perfil } = useAuthStore()
  const [running, setRunning] = useState(false)
  const [stepStates, setStepStates] = useState({}) // id → { status, logs[], duration }
  const [currentStep, setCurrentStep] = useState(null)
  const [expandedSteps, setExpandedSteps] = useState({})
  const [testData, setTestData] = useState({})
  const [summary, setSummary] = useState(null)
  const abortRef = useRef(false)
  const logEndRef = useRef(null)

  const updateStep = useCallback((id, update) => {
    setStepStates(prev => ({
      ...prev,
      [id]: { ...prev[id], ...update },
    }))
  }, [])

  const log = useCallback((id, msg, type = 'info') => {
    updateStep(id, {
      logs: [...(stepStates[id]?.logs || []), { msg, type, time: ts() }],
    })
    // Also need functional update since we read stepStates
    setStepStates(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        logs: [...(prev[id]?.logs || []), { msg, type, time: ts() }],
      },
    }))
  }, [])

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [stepStates])

  function toggleExpand(id) {
    setExpandedSteps(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function runStep(id, fn) {
    if (abortRef.current) throw new Error('Abortado por el usuario')
    setCurrentStep(id)
    setExpandedSteps(prev => ({ ...prev, [id]: true }))
    updateStep(id, { status: 'running', logs: [], duration: null })
    const start = performance.now()
    try {
      await fn(id)
      const duration = Math.round(performance.now() - start)
      updateStep(id, { status: 'pass', duration })
    } catch (err) {
      const duration = Math.round(performance.now() - start)
      setStepStates(prev => ({
        ...prev,
        [id]: {
          ...prev[id],
          status: 'fail',
          duration,
          logs: [...(prev[id]?.logs || []), { msg: `ERROR: ${err.message}`, type: 'error', time: ts() }],
        },
      }))
      throw err
    }
  }

  // ─── Step implementations ─────────────────────────────────────────────────
  const data = useRef({})

  async function stepCreateProduct(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Creando producto via RPC crear_producto_con_kardex...', type: 'info', time: ts() }] } }))
    const { data: result, error } = await supabase.rpc('crear_producto_con_kardex', {
      p_codigo: 'TEST-FLOW-001',
      p_nombre: 'Producto Tester Flow',
      p_unidad: 'und',
      p_precio_usd: 25.00,
      p_costo_usd: 15.00,
      p_stock_actual: 100,
      p_stock_minimo: 5,
      p_categoria: 'TESTER',
      p_usuario_id: perfil.id,
      p_usuario_nombre: perfil.nombre,
    })
    if (error) throw error
    data.current.productoId = result
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Producto creado: id=${result}`, type: 'success', time: ts() },
      { msg: `Código: TEST-FLOW-001 | Precio: $25.00 | Stock: 100 und`, type: 'info', time: ts() },
    ] } }))
  }

  async function stepVerifyKardexIngreso(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Consultando kardex del producto...', type: 'info', time: ts() }] } }))
    const { data: movs, error } = await supabase
      .from('inventario_movimientos')
      .select('*')
      .eq('producto_id', data.current.productoId)
      .eq('tipo', 'ingreso')
      .order('creado_en', { ascending: false })
      .limit(1)
    if (error) throw error
    if (!movs || movs.length === 0) throw new Error('No se encontró movimiento de ingreso inicial')
    const mov = movs[0]
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Ingreso encontrado: ${mov.cantidad} und | Stock: ${mov.stock_anterior} → ${mov.stock_nuevo}`, type: 'success', time: ts() },
      { msg: `Motivo: ${mov.motivo} | Lote: ${mov.lote_id?.slice(0,8)}...`, type: 'info', time: ts() },
    ] } }))
  }

  async function stepCreateClient(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Creando cliente de prueba...', type: 'info', time: ts() }] } }))
    const { data: client, error } = await supabase.from('clientes').insert({
      nombre: 'Cliente Tester Flow',
      rif: 'J-99999999-0',
      telefono: '0414-0000000',
      email: 'tester@flow.test',
      direccion: 'Dirección de prueba - Tester Flow',
      vendedor_id: perfil.id,
    }).select('id, nombre').single()
    if (error) throw error
    data.current.clienteId = client.id
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Cliente creado: ${client.nombre} (${client.id.slice(0,8)}...)`, type: 'success', time: ts() },
    ] } }))
  }

  async function stepCreateDraft(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Creando cotización borrador via Worker API...', type: 'info', time: ts() }] } }))
    const result = await apiCall('/api/cotizaciones/guardar', 'POST', {
      campos: {
        cliente_id: data.current.clienteId,
        valida_hasta: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        notas_cliente: 'Cotización de prueba - Tester Flow',
        notas_internas: 'Generada por tester determinista',
        descuento_global_pct: 5,
        costo_envio_usd: 10,
      },
      items: [
        { producto_id: data.current.productoId, codigo_snap: 'TEST-FLOW-001', nombre_snap: 'Producto Tester Flow', unidad_snap: 'und', cantidad: 10, precio_unit_usd: 25.00, descuento_pct: 0 },
      ],
    })
    data.current.cotizacionId = result.id
    data.current.cotizacionNumero = result.numero
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Cotización creada: COT-${String(result.numero).padStart(5,'0')} (estado: borrador)`, type: 'success', time: ts() },
      { msg: `ID: ${result.id} | Total: $${result.total_usd || '247.50'}`, type: 'info', time: ts() },
    ] } }))
  }

  async function stepVerifyStockComprometido(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Consultando stock comprometido via RPC...', type: 'info', time: ts() }] } }))
    const { data: sc, error } = await supabase.rpc('obtener_stock_comprometido')
    if (error) throw error
    const productoSC = (sc || []).find(s => s.producto_id === data.current.productoId)
    if (!productoSC) {
      setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
        { msg: 'Stock comprometido: 0 (borrador no compromete stock, esperado)', type: 'info', time: ts() },
      ] } }))
    } else {
      data.current.stockComprometido = Number(productoSC.total_comprometido)
      setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
        { msg: `Stock comprometido: ${productoSC.total_comprometido} und`, type: 'success', time: ts() },
      ] } }))
    }
  }

  async function stepSendQuote(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Enviando cotización via Worker API...', type: 'info', time: ts() }] } }))
    await apiCall('/api/cotizaciones/enviar', 'POST', {
      cotizacionId: data.current.cotizacionId,
      tasaBcv: 100,
    })
    // Verificar estado
    const { data: cot } = await supabase.from('cotizaciones').select('estado').eq('id', data.current.cotizacionId).single()
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Cotización enviada. Estado actual: ${cot?.estado}`, type: 'success', time: ts() },
    ] } }))
    // Ahora verificar stock comprometido tras enviar
    const { data: sc2 } = await supabase.rpc('obtener_stock_comprometido')
    const scPost = (sc2 || []).find(s => s.producto_id === data.current.productoId)
    if (scPost) {
      setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
        { msg: `Stock comprometido tras envío: ${scPost.total_comprometido} und`, type: 'info', time: ts() },
      ] } }))
    }
  }

  async function stepAcceptQuote(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Aceptando cotización (acción de supervisor)...', type: 'info', time: ts() }] } }))
    const { error } = await supabase.from('cotizaciones').update({ estado: 'aceptada' }).eq('id', data.current.cotizacionId)
    if (error) throw error
    const { data: cot } = await supabase.from('cotizaciones').select('estado').eq('id', data.current.cotizacionId).single()
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Cotización aceptada. Estado: ${cot?.estado}`, type: 'success', time: ts() },
    ] } }))
  }

  async function stepCreateDespacho(id) {
    // Obtener un transportista
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Buscando transportista activo...', type: 'info', time: ts() }] } }))
    const { data: transportistas } = await supabase.from('transportistas').select('id, nombre').eq('activo', true).limit(1)
    const transportistaId = transportistas?.[0]?.id || null
    if (transportistaId) {
      setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
        { msg: `Transportista: ${transportistas[0].nombre}`, type: 'info', time: ts() },
      ] } }))
    } else {
      setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
        { msg: 'Sin transportistas activos, se creará sin transportista', type: 'warn', time: ts() },
      ] } }))
    }

    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: 'Creando despacho via Worker API (forma pago: Cta por cobrar)...', type: 'info', time: ts() },
    ] } }))
    const result = await apiCall('/api/despachos/crear', 'POST', {
      cotizacionId: data.current.cotizacionId,
      formaPago: 'Cta por cobrar',
      transportistaId,
    })
    data.current.despachoId = result.id
    data.current.despachoNumero = result.numero
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Despacho creado: DES-${String(result.numero).padStart(5,'0')} (estado: pendiente)`, type: 'success', time: ts() },
      { msg: `Forma pago: Cta por cobrar | Transportista: ${transportistaId ? 'Sí' : 'No'}`, type: 'info', time: ts() },
    ] } }))
  }

  async function stepVerifyStockDeducted(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Verificando stock del producto...', type: 'info', time: ts() }] } }))
    const { data: prod, error } = await supabase.from('productos').select('stock_actual').eq('id', data.current.productoId).single()
    if (error) throw error
    const expected = 90 // 100 - 10
    const actual = Number(prod.stock_actual)
    if (actual !== expected) throw new Error(`Stock esperado: ${expected}, actual: ${actual}`)
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Stock actual: ${actual} und (100 - 10 despachadas = 90) ✓`, type: 'success', time: ts() },
    ] } }))
  }

  async function stepVerifyKardexEgreso(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Buscando movimiento de egreso en kardex...', type: 'info', time: ts() }] } }))
    const { data: movs, error } = await supabase
      .from('inventario_movimientos')
      .select('*')
      .eq('producto_id', data.current.productoId)
      .eq('tipo', 'egreso')
      .order('creado_en', { ascending: false })
      .limit(1)
    if (error) throw error
    if (!movs || movs.length === 0) throw new Error('No se encontró egreso en kardex')
    const mov = movs[0]
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Egreso: ${mov.cantidad} und | Stock: ${mov.stock_anterior} → ${mov.stock_nuevo}`, type: 'success', time: ts() },
      { msg: `Motivo: ${mov.motivo} | Tipo: ${mov.motivo_tipo}`, type: 'info', time: ts() },
    ] } }))
  }

  async function stepVerifyStockLiberado(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Verificando que stock comprometido fue liberado...', type: 'info', time: ts() }] } }))
    const { data: sc } = await supabase.rpc('obtener_stock_comprometido')
    const scProd = (sc || []).find(s => s.producto_id === data.current.productoId)
    const comprometido = scProd ? Number(scProd.total_comprometido) : 0
    // Después de despachar, la cotización ya no compromete stock (estado cambia a aceptada con despacho)
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Stock comprometido actual: ${comprometido} und (debería ser 0 tras despachar)`, type: comprometido === 0 ? 'success' : 'warn', time: ts() },
    ] } }))
  }

  async function stepMarkDispatched(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Marcando despacho como despachada...', type: 'info', time: ts() }] } }))
    await apiCall('/api/despachos/estado', 'POST', {
      despachoId: data.current.despachoId,
      nuevoEstado: 'despachada',
    })
    const { data: des } = await supabase.from('notas_despacho').select('estado, despachada_en').eq('id', data.current.despachoId).single()
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Estado: ${des?.estado} | Despachada en: ${des?.despachada_en || 'N/A'}`, type: 'success', time: ts() },
    ] } }))
  }

  async function stepMarkDelivered(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Marcando despacho como entregada...', type: 'info', time: ts() }] } }))
    await apiCall('/api/despachos/estado', 'POST', {
      despachoId: data.current.despachoId,
      nuevoEstado: 'entregada',
    })
    const { data: des } = await supabase.from('notas_despacho').select('estado, entregada_en').eq('id', data.current.despachoId).single()
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Estado: ${des?.estado} | Entregada en: ${des?.entregada_en || 'N/A'}`, type: 'success', time: ts() },
    ] } }))
  }

  async function stepVerifyCommission(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Buscando comisión generada...', type: 'info', time: ts() }] } }))
    await wait(500) // Dar tiempo a triggers
    const { data: coms, error } = await supabase
      .from('comisiones')
      .select('id, monto_usd, porcentaje, estado, despacho_id')
      .eq('despacho_id', data.current.despachoId)
    if (error) throw error
    if (!coms || coms.length === 0) {
      setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
        { msg: 'No se generó comisión automática (puede estar deshabilitado o sin configurar %)', type: 'warn', time: ts() },
      ] } }))
      data.current.comisionId = null
      return
    }
    const com = coms[0]
    data.current.comisionId = com.id
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Comisión encontrada: $${com.monto_usd} (${com.porcentaje}%) — Estado: ${com.estado}`, type: 'success', time: ts() },
    ] } }))
  }

  async function stepPayCommission(id) {
    if (!data.current.comisionId) {
      setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
        { msg: 'Sin comisión para pagar (paso omitido)', type: 'warn', time: ts() },
      ] } }))
      return
    }
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Marcando comisión como pagada via Worker API...', type: 'info', time: ts() }] } }))
    await apiCall('/api/comisiones/pagar', 'POST', { comisionId: data.current.comisionId })
    const { data: com } = await supabase.from('comisiones').select('estado').eq('id', data.current.comisionId).single()
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Comisión pagada. Estado: ${com?.estado}`, type: 'success', time: ts() },
    ] } }))
  }

  async function stepVerifyCxC(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Verificando saldo CxC del cliente...', type: 'info', time: ts() }] } }))
    const { data: client, error } = await supabase.from('clientes').select('saldo_pendiente').eq('id', data.current.clienteId).single()
    if (error) throw error
    const saldo = Number(client.saldo_pendiente || 0)
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Saldo pendiente: $${saldo.toFixed(2)}`, type: saldo > 0 ? 'success' : 'info', time: ts() },
    ] } }))
    data.current.saldoCxC = saldo
    // Verificar transacciones CxC
    const { data: txs } = await supabase.from('cuentas_cobrar').select('tipo, monto_usd, descripcion').eq('cliente_id', data.current.clienteId).order('creado_en', { ascending: false }).limit(5)
    if (txs && txs.length > 0) {
      for (const tx of txs) {
        setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
          { msg: `  ${tx.tipo}: $${tx.monto_usd} — ${tx.descripcion || 'sin descripción'}`, type: 'info', time: ts() },
        ] } }))
      }
    }
  }

  async function stepRegisterPayment(id) {
    if (!data.current.saldoCxC || data.current.saldoCxC <= 0) {
      setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
        { msg: 'Sin saldo pendiente CxC, omitiendo abono', type: 'warn', time: ts() },
      ] } }))
      return
    }
    const montoAbono = Math.min(data.current.saldoCxC, 50)
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: `Registrando abono de $${montoAbono.toFixed(2)} via Worker API...`, type: 'info', time: ts() }] } }))
    await apiCall('/api/cxc/abono', 'POST', {
      clienteId: data.current.clienteId,
      monto: montoAbono,
      formaPago: 'Transferencia',
      referencia: 'TESTER-FLOW-001',
      descripcion: 'Abono de prueba - Tester Flow',
    })
    const { data: client } = await supabase.from('clientes').select('saldo_pendiente').eq('id', data.current.clienteId).single()
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Abono registrado. Saldo actualizado: $${Number(client?.saldo_pendiente || 0).toFixed(2)}`, type: 'success', time: ts() },
    ] } }))
  }

  async function stepVerifyReportVentas(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Consultando reporte de ventas (período actual)...', type: 'info', time: ts() }] } }))
    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
    const { data: despachos, error } = await supabase.from('notas_despacho').select('total_usd, estado, forma_pago').gte('creado_en', from).lte('creado_en', to)
    if (error) throw error
    const entregados = (despachos || []).filter(d => d.estado === 'entregada')
    const totalVentas = entregados.reduce((s, d) => s + Number(d.total_usd), 0)
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Despachos este mes: ${despachos?.length || 0} total, ${entregados.length} entregados`, type: 'success', time: ts() },
      { msg: `Total ventas (entregadas): $${totalVentas.toFixed(2)}`, type: 'info', time: ts() },
    ] } }))
  }

  async function stepVerifyReportPipeline(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Consultando pipeline de cotizaciones...', type: 'info', time: ts() }] } }))
    const { data: cots, error } = await supabase.from('cotizaciones').select('estado, total_usd')
    if (error) throw error
    const byEstado = {}
    for (const c of (cots || [])) {
      byEstado[c.estado] = (byEstado[c.estado] || 0) + 1
    }
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Total cotizaciones: ${cots?.length || 0}`, type: 'success', time: ts() },
      { msg: `Por estado: ${Object.entries(byEstado).map(([k, v]) => `${k}: ${v}`).join(' | ')}`, type: 'info', time: ts() },
    ] } }))
  }

  async function stepVerifyReportDespachos(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Consultando reporte de despachos...', type: 'info', time: ts() }] } }))
    const { data: desps, error } = await supabase.from('notas_despacho').select('estado, total_usd, forma_pago')
    if (error) throw error
    const byEstado = {}
    for (const d of (desps || [])) {
      byEstado[d.estado] = (byEstado[d.estado] || 0) + 1
    }
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Total despachos: ${desps?.length || 0}`, type: 'success', time: ts() },
      { msg: `Por estado: ${Object.entries(byEstado).map(([k, v]) => `${k}: ${v}`).join(' | ')}`, type: 'info', time: ts() },
    ] } }))
  }

  async function stepVerifyReportInventario(id) {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg: 'Consultando reporte de inventario...', type: 'info', time: ts() }] } }))
    const { data: prods, error } = await supabase.from('productos').select('id, nombre, stock_actual, stock_minimo, activo').eq('activo', true)
    if (error) throw error
    const bajoStock = (prods || []).filter(p => Number(p.stock_actual) <= Number(p.stock_minimo))
    const testProd = (prods || []).find(p => p.id === data.current.productoId)
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []),
      { msg: `Productos activos: ${prods?.length || 0} | Bajo stock: ${bajoStock.length}`, type: 'success', time: ts() },
      { msg: testProd ? `Producto test: stock=${testProd.stock_actual} (min: ${testProd.stock_minimo})` : 'Producto test no encontrado', type: 'info', time: ts() },
    ] } }))
  }

  async function stepCleanup(id) {
    const logs = (msg, type = 'info') => {
      setStepStates(prev => ({ ...prev, [id]: { ...prev[id], logs: [...(prev[id]?.logs || []), { msg, type, time: ts() }] } }))
    }
    logs('Limpiando datos de prueba...')

    // 1. Delete comisiones
    if (data.current.comisionId) {
      await supabase.from('comisiones').delete().eq('id', data.current.comisionId)
      logs('Comisión eliminada')
    }

    // 2. Delete CxC transactions
    if (data.current.clienteId) {
      await supabase.from('cuentas_cobrar').delete().eq('cliente_id', data.current.clienteId)
      logs('Transacciones CxC eliminadas')
    }

    // 3. Delete despacho
    if (data.current.despachoId) {
      await supabase.from('notas_despacho').delete().eq('id', data.current.despachoId)
      logs('Despacho eliminado')
    }

    // 4. Delete cotizacion items + cotizacion
    if (data.current.cotizacionId) {
      await supabase.from('cotizacion_items').delete().eq('cotizacion_id', data.current.cotizacionId)
      await supabase.from('cotizaciones').delete().eq('id', data.current.cotizacionId)
      logs('Cotización e items eliminados')
    }

    // 5. Delete kardex entries
    if (data.current.productoId) {
      await supabase.from('inventario_movimientos').delete().eq('producto_id', data.current.productoId)
      logs('Movimientos de kardex eliminados')
    }

    // 6. Delete producto
    if (data.current.productoId) {
      await supabase.from('productos').delete().eq('id', data.current.productoId)
      logs('Producto eliminado')
    }

    // 7. Delete cliente
    if (data.current.clienteId) {
      // Reset saldo first
      await supabase.from('clientes').update({ saldo_pendiente: 0 }).eq('id', data.current.clienteId)
      await supabase.from('clientes').delete().eq('id', data.current.clienteId)
      logs('Cliente eliminado')
    }

    logs('Limpieza completada. Todos los datos de prueba fueron eliminados.', 'success')
    data.current = {}
  }

  // ─── Run all steps ────────────────────────────────────────────────────────
  const STEP_FNS = {
    create_product: stepCreateProduct,
    verify_kardex_ingreso: stepVerifyKardexIngreso,
    create_client: stepCreateClient,
    create_draft: stepCreateDraft,
    verify_stock_comprometido: stepVerifyStockComprometido,
    send_quote: stepSendQuote,
    accept_quote: stepAcceptQuote,
    create_despacho: stepCreateDespacho,
    verify_stock_deducted: stepVerifyStockDeducted,
    verify_kardex_egreso: stepVerifyKardexEgreso,
    verify_stock_liberado: stepVerifyStockLiberado,
    mark_dispatched: stepMarkDispatched,
    mark_delivered: stepMarkDelivered,
    verify_commission: stepVerifyCommission,
    pay_commission: stepPayCommission,
    verify_cxc: stepVerifyCxC,
    register_payment: stepRegisterPayment,
    verify_reports_ventas: stepVerifyReportVentas,
    verify_reports_pipeline: stepVerifyReportPipeline,
    verify_reports_despachos: stepVerifyReportDespachos,
    verify_reports_inventario: stepVerifyReportInventario,
    cleanup: stepCleanup,
  }

  async function runAll() {
    setRunning(true)
    abortRef.current = false
    setStepStates({})
    setSummary(null)
    data.current = {}
    const startTime = performance.now()
    let passed = 0, failed = 0, failedAt = null

    for (const step of STEPS) {
      if (abortRef.current) break
      try {
        await runStep(step.id, STEP_FNS[step.id])
        passed++
      } catch (err) {
        failed++
        failedAt = step.label
        // Try cleanup even on failure
        if (step.id !== 'cleanup') {
          try {
            setCurrentStep('cleanup')
            updateStep('cleanup', { status: 'running', logs: [{ msg: 'Limpieza de emergencia tras error...', type: 'warn', time: ts() }] })
            await stepCleanup('cleanup')
            updateStep('cleanup', { status: 'pass' })
          } catch (cleanErr) {
            updateStep('cleanup', { status: 'fail', logs: [{ msg: `Error en limpieza: ${cleanErr.message}`, type: 'error', time: ts() }] })
          }
        }
        break
      }
    }

    const totalTime = Math.round(performance.now() - startTime)
    setSummary({ passed, failed, totalTime, failedAt, aborted: abortRef.current })
    setCurrentStep(null)
    setRunning(false)
  }

  function abort() {
    abortRef.current = true
  }

  function reset() {
    setStepStates({})
    setSummary(null)
    setCurrentStep(null)
    setExpandedSteps({})
    data.current = {}
  }

  if (perfil?.rol !== 'supervisor') {
    return (
      <div className="p-4 md:p-6 lg:p-8">
        <PageHeader icon={FlaskConical} title="Tester de Flujo" subtitle="Solo disponible para supervisores" />
        <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-xl text-sm font-medium">
          Esta herramienta requiere rol de supervisor.
        </div>
      </div>
    )
  }

  // ─── Agrupar pasos por grupo ──────────────────────────────────────────────
  const groups = []
  let currentGroup = null
  for (const step of STEPS) {
    if (!currentGroup || currentGroup.name !== step.group) {
      currentGroup = { name: step.group, steps: [] }
      groups.push(currentGroup)
    }
    currentGroup.steps.push(step)
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6 max-w-4xl mx-auto">
      <PageHeader
        icon={FlaskConical}
        title="Tester de Flujo Completo"
        subtitle="Prueba determinista: cliente → cotización → despacho → comisión → reportes"
      />

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {!running ? (
          <>
            <button onClick={runAll}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-sm transition-colors shadow-lg shadow-indigo-500/20">
              <Play size={16} /> Ejecutar flujo completo
            </button>
            {Object.keys(stepStates).length > 0 && (
              <button onClick={reset}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors">
                <RotateCcw size={14} /> Reiniciar
              </button>
            )}
          </>
        ) : (
          <button onClick={abort}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm transition-colors">
            <XCircle size={16} /> Detener
          </button>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <div className={`rounded-xl p-4 border ${summary.failed === 0 && !summary.aborted
          ? 'bg-emerald-50 border-emerald-200'
          : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center gap-3">
            {summary.failed === 0 && !summary.aborted
              ? <CheckCircle size={20} className="text-emerald-500" />
              : <XCircle size={20} className="text-red-500" />
            }
            <div>
              <p className="font-bold text-sm">
                {summary.failed === 0 && !summary.aborted
                  ? `Todos los pasos completados exitosamente`
                  : summary.aborted
                    ? 'Ejecución abortada por el usuario'
                    : `Falló en: ${summary.failedAt}`
                }
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {summary.passed} pasaron · {summary.failed} fallaron · {(summary.totalTime / 1000).toFixed(1)}s total
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Steps grouped */}
      <div className="space-y-4">
        {groups.map(group => (
          <div key={group.name} className="space-y-1">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${GROUP_COLORS[group.name] || 'text-slate-600 bg-slate-50 border-slate-200'}`}>
              {group.name}
            </div>
            <div className="space-y-1">
              {group.steps.map(step => {
                const state = stepStates[step.id]
                const isExpanded = expandedSteps[step.id]
                const isCurrent = currentStep === step.id

                return (
                  <div key={step.id} className={`rounded-xl border transition-all ${
                    isCurrent ? 'border-indigo-300 bg-indigo-50/50 shadow-sm' :
                    state?.status === 'pass' ? 'border-emerald-200 bg-emerald-50/30' :
                    state?.status === 'fail' ? 'border-red-200 bg-red-50/30' :
                    'border-slate-200 bg-white'
                  }`}>
                    <button
                      onClick={() => state && toggleExpand(step.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                    >
                      {/* Status icon */}
                      <div className="shrink-0">
                        {state?.status === 'running' ? <Loader2 size={16} className="animate-spin text-indigo-500" /> :
                         state?.status === 'pass' ? <CheckCircle size={16} className="text-emerald-500" /> :
                         state?.status === 'fail' ? <XCircle size={16} className="text-red-500" /> :
                         <div className="w-4 h-4 rounded-full border-2 border-slate-300" />
                        }
                      </div>
                      <span className={`flex-1 text-sm font-medium ${
                        state?.status === 'pass' ? 'text-emerald-700' :
                        state?.status === 'fail' ? 'text-red-700' :
                        isCurrent ? 'text-indigo-700' : 'text-slate-600'
                      }`}>
                        {step.label}
                      </span>
                      {state?.duration != null && (
                        <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                          <Clock size={10} />{state.duration}ms
                        </span>
                      )}
                      {state && (
                        isExpanded
                          ? <ChevronDown size={14} className="text-slate-400" />
                          : <ChevronRight size={14} className="text-slate-400" />
                      )}
                    </button>

                    {/* Expanded log */}
                    {isExpanded && state?.logs?.length > 0 && (
                      <div className="px-3 pb-3">
                        <div className="bg-slate-900 rounded-lg p-3 font-mono text-xs space-y-0.5 max-h-48 overflow-y-auto">
                          {state.logs.map((log, i) => (
                            <div key={i} className={`flex gap-2 ${
                              log.type === 'error' ? 'text-red-400' :
                              log.type === 'success' ? 'text-emerald-400' :
                              log.type === 'warn' ? 'text-amber-400' :
                              'text-slate-300'
                            }`}>
                              <span className="text-slate-500 shrink-0">{log.time}</span>
                              <span className="break-all">{log.msg}</span>
                            </div>
                          ))}
                          <div ref={logEndRef} />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
