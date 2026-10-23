// src/components/despachos/EditarPagoEntregadoModal.jsx
// Corregir los métodos de pago de un despacho ENTREGADO (vía especial "soloPagoEntregado").
// Visible solo para administración/jefe/desarrollador; el servidor vuelve a validar el rol y
// RECHAZA la operación completa si el body lleva cualquier otro campo (flete, transportista,
// notas, cliente, dirección). Por eso aquí SOLO se envían: forma de pago del despacho, forma de
// pago del cliente (el mismo JSON) y la referencia opcional.
// El Cobro a destino (COD) se muestra en SOLO LECTURA: por esta vía no se puede quitar, marcar
// como pagado ni cambiar su monto (eso es exclusivo del flujo de conciliación con evidencia o de
// la reversión autorizada, y el servidor lo rechaza igual).
import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Pencil, Loader2, Lock, AlertTriangle, DollarSign, Undo2, CheckCircle2, ArrowDownCircle } from 'lucide-react'
import { useEditarDespacho } from '../../hooks/useDespachos'
import { useRegistrarAbono, useRevertirCargoCxc } from '../../hooks/useCuentasCobrar'
import { authFetch } from '../../services/authFetch'
import { showToast } from '../ui/Toast'
import { useFormasPago } from '../../hooks/useFormasPago'
import { getSalePaymentMethods } from '../../constants/formasPago'
import { round2 } from '../../utils/dinero'

const esCod = (f) => f?.metodo === 'Cobro a destino'

// Formas de pago reales para un abono (mismo conjunto que la conciliación COD):
// dinero que entra de verdad, no cuentas internas como crédito o cruce.
const METODOS_ABONO = ['Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'Punto de Venta', 'USDT']

// Parsea el JSON de formas de pago igual que el servidor. Devuelve las entradas COD tal cual
// (el servidor exige que la entrada COD sea idéntica a la guardada cuando ya está pagada, así
// que aquí NUNCA se copia ni se reordena esa entrada) y el resto como métodos editables.
function parsearFormas(despacho) {
  const parse = (raw) => {
    try {
      const fp = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(fp) ? fp : null
    } catch {
      return null
    }
  }
  const delCliente = parse(despacho?.forma_pago_cliente)
  const delDespacho = parse(despacho?.forma_pago)
  const huboDatos = !!(despacho?.forma_pago_cliente || despacho?.forma_pago)
  // Fuente de verdad: la que tenga registros (siempre la misma para mostrar y guardar).
  const fp = (delCliente && delCliente.length > 0) ? delCliente
    : (delDespacho && delDespacho.length > 0) ? delDespacho
    : (delCliente || delDespacho)
  if (!fp) return { codItems: [], pagos: [], formatoLegado: huboDatos }
  return { codItems: fp.filter(esCod), pagos: fp.filter(f => !esCod(f)), formatoLegado: false }
}

export default function EditarPagoEntregadoModal({ isOpen, onClose, despacho }) {
  const editarDespacho = useEditarDespacho()

  // Estado REAL de las cuentas por cobrar del despacho (mismo resumen que usa la
  // conciliación COD): para mostrar el impacto contable antes de corregir nada.
  const { data: resumen } = useQuery({
    queryKey: ['resumen-financiero', despacho?.id],
    enabled: isOpen && !!despacho?.id,
    retry: false,
    queryFn: async () => {
      const response = await authFetch('/api/despachos/resumen-financiero', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ despachoId: despacho.id }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'No se pudo leer el saldo del despacho')
      return data.resumen
    },
  })
  const [referenciaPago, setReferenciaPago] = useState(() => despacho?.referencia_pago || '')

  // ── Cuadre de CxC ("paso 2" del guardado) ─────────────────────────────────
  // Al guardar una corrección que cambió la parte a crédito, en el MISMO paso se
  // ofrece cuadrar la deuda real del despacho: registrar el abono (si el cliente
  // pagó ahora) o revertir el cargo (si la parte a crédito era un error de captura).
  const queryClient = useQueryClient()
  const registrarAbono = useRegistrarAbono()
  const revertirCargo = useRevertirCargoCxc()
  const [paso, setPaso] = useState('form') // 'form' | 'cuadre'
  const [cuadre, setCuadre] = useState(null) // foto del estado CxC al momento de guardar
  const [cuadreTipo, setCuadreTipo] = useState('abono') // opción abierta: 'abono' | 'revertir'
  const [cuadreListo, setCuadreListo] = useState(null) // 'abono' | 'revertir' cuando ya se aplicó
  const [abonoMonto, setAbonoMonto] = useState('')
  const [abonoForma, setAbonoForma] = useState('Efectivo $')
  const [abonoReferencia, setAbonoReferencia] = useState('')
  const [abonoKey, setAbonoKey] = useState('') // clave estable por operación (reintentos sin duplicar)
  const [revertMonto, setRevertMonto] = useState('')
  const [revertMotivo, setRevertMotivo] = useState('')

  // Se parsea con useMemo (no en un efecto) para que el total editable sea correcto desde el
  // primer render y el motor de formas de pago no "ajuste" montos cargados de la base.
  const { codItems, pagos: pagosIniciales, formatoLegado } = useMemo(() => parsearFormas(despacho), [despacho])

  const totalUsd = Number(despacho?.total_usd || 0)
  const montoCod = useMemo(() => round2(codItems.reduce((s, c) => s + (Number(c.monto) || 0), 0)), [codItems])
  // Lo que deben cubrir los métodos editables: el total menos el Cobro a destino (que no se toca).
  const totalEditable = useMemo(() => Math.max(0, round2(totalUsd - montoCod)), [totalUsd, montoCod])

  const {
    formasPago: pagos,
    setFormas: setPagos,
    toggleForma,
    setMontoForma,
    updateForma,
    totalAsignado,
    pagoCuadrado,
  } = useFormasPago(totalEditable)

  // Cargar los métodos actuales al abrir: ajuste de estado durante el render (patrón
  // recomendado de React para sincronizar estado con nuevas props, sin usar efectos).
  // En el paso de cuadre NO se resetea con el mismo despacho: al guardar se invalida la
  // lista y el objeto puede cambiar de identidad sin que el despacho cambie de verdad.
  const [cargadoDe, setCargadoDe] = useState(null)
  const mismoDespachoQueCargado = !!cargadoDe && despacho && cargadoDe.id === despacho.id
  if (isOpen && despacho && cargadoDe !== despacho && !(paso === 'cuadre' && mismoDespachoQueCargado)) {
    setCargadoDe(despacho)
    setPagos(pagosIniciales)
    setReferenciaPago(despacho.referencia_pago || '')
    setPaso('form')
    setCuadre(null)
    setCuadreListo(null)
  }

  if (!isOpen || !despacho) return null

  const numDisplay = despacho.cotizacion
    ? `DES-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : `DES-${String(despacho.numero).padStart(5, '0')}`

  // Vencimiento estimado de las líneas "Cta por cobrar" (mismo criterio que la tarjeta).
  const infoVencimientoCxc = (fp) => {
    if (fp?.metodo !== 'Cta por cobrar') return null
    const dias = Number(fp.diasVencimiento)
    if (!(dias > 0) || !despacho?.creado_en) return null
    const fVenc = new Date(new Date(despacho.creado_en).getTime() + dias * 24 * 60 * 60 * 1000)
    const restantes = Math.ceil((fVenc - new Date()) / (24 * 60 * 60 * 1000))
    return restantes < 0 ? `Vencido hace ${Math.abs(restantes)} d` : `Vence en ${restantes} d`
  }

  // Parte a crédito (Cta por cobrar): cuánto hay hoy vs cuánto quedaría corregido, y la
  // deuda REAL según el módulo de CxC (la corrección de métodos NO la modifica nunca).
  const sumarCxc = (lista) => round2(lista.filter(p => p?.metodo === 'Cta por cobrar').reduce((s, p) => s + (Number(p.monto) || 0), 0))
  const cxcActual = sumarCxc(pagosIniciales)
  const cxcEditado = sumarCxc(pagos)
  const cambiaCxc = cxcActual !== cxcEditado
  const ledger = resumen?.ledger
  const cargoCxc = round2(Number(ledger?.cargo_cxc_usd) || 0)
  const abonoCxc = round2(Number(ledger?.abono_cxc_usd) || 0)
  const deudaCxc = round2(Number(ledger?.deuda_cxc_usd) || 0)
  const fmtUsd = (n) => `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const cxcInvalido = pagos.some(p => p.metodo === 'Cta por cobrar' && !(Number(p.diasVencimiento) > 0))
  // Se guarda cuando los métodos cubren el total editable (se permite excedente/vuelto, igual
  // que la edición normal), o cuando no queda nada que cubrir (solo se corrige la referencia).
  const sumaOk = pagos.length > 0 ? pagoCuadrado : totalEditable <= 0.02
  const puedeGuardar = !formatoLegado && sumaOk && !cxcInvalido
  const cargando = editarDespacho.isPending

  async function handleGuardar() {
    if (!puedeGuardar || cargando) return
    // Las entradas COD viajan INTACTAS (mismo objeto, mismo orden de claves): si están pagadas,
    // el servidor compara la entrada byte a byte y rechaza cualquier diferencia.
    const fpJson = JSON.stringify([...pagos, ...codItems])
    try {
      await editarDespacho.mutateAsync({
        despachoId: despacho.id,
        soloPagoEntregado: true,
        formaPago: fpJson,
        formaPagoCliente: fpJson,
        referenciaPago: referenciaPago.trim() || null,
      })
    } catch {
      // useEditarDespacho ya mostró el error en un aviso
      return
    }

    // ¿La corrección tocó la parte a crédito y queda deuda o cargo en los libros?
    // Entonces el mismo paso ofrece el cuadre de CxC antes de cerrar.
    const diferencia = round2(cargoCxc - cxcEditado)
    if (!(cambiaCxc && (cargoCxc > 0 || deudaCxc > 0))) {
      onClose()
      return
    }
    setCuadre({
      cxcActual,
      cxcEditado,
      cargoCxc,
      abonoCxc,
      deudaCxc,
      diferencia,
      // Cliente dueño de la deuda (mismo criterio que la edición profunda y las devoluciones).
      clienteId: despacho.cliente_factura_id || despacho.cliente_id || despacho.cotizacion?.cliente_id || null,
    })
    const sugerido = diferencia > 0 ? Math.min(diferencia, deudaCxc) : deudaCxc
    setAbonoMonto(sugerido > 0 ? sugerido.toFixed(2) : '')
    setAbonoForma('Efectivo $')
    setAbonoReferencia('')
    setAbonoKey(crypto.randomUUID())
    setRevertMonto(Math.min(cxcEditado, cargoCxc).toFixed(2))
    setRevertMotivo('')
    setCuadreTipo(diferencia > 0 ? 'abono' : 'revertir')
    setCuadreListo(null)
    setPaso('cuadre')
  }

  // ── Acciones del cuadre de CxC ────────────────────────────────────────────
  const cuadreAbonoMonto = Number(abonoMonto) || 0
  const cuadreRevertMonto = Number(revertMonto) || 0
  const cuadreOcupado = registrarAbono.isPending || revertirCargo.isPending
  const abonoValido = cuadreAbonoMonto > 0 && !!cuadre?.clienteId && !cuadreOcupado
  const revertValido = revertMonto !== '' && cuadreRevertMonto >= 0
    && cuadreRevertMonto <= (cuadre?.cargoCxc ?? 0) && revertMotivo.trim().length >= 4 && !cuadreOcupado

  async function handleCuadreAbono() {
    if (!abonoValido) return
    try {
      await registrarAbono.mutateAsync({
        clienteId: cuadre.clienteId,
        monto: cuadreAbonoMonto,
        formaPago: abonoForma,
        referencia: abonoReferencia.trim() || null,
        descripcion: `Abono por cuadre de corrección de pago (${numDisplay})`,
        despachoId: despacho.id,
        // Clave estable por operación: un reintento reutiliza la misma clave y el
        // servidor devuelve el abono ya registrado en vez de duplicarlo.
        idempotencyKey: abonoKey,
      })
      queryClient.invalidateQueries({ queryKey: ['resumen-financiero'] })
      setCuadreListo('abono')
    } catch (e) {
      showToast(e?.message || 'No se pudo registrar el abono', 'error')
    }
  }

  async function handleCuadreRevertir() {
    if (!revertValido) return
    try {
      await revertirCargo.mutateAsync({
        despachoId: despacho.id,
        montoNuevo: cuadreRevertMonto,
        motivo: revertMotivo.trim(),
      })
      queryClient.invalidateQueries({ queryKey: ['resumen-financiero'] })
      setCuadreListo('revertir')
    } catch (e) {
      showToast(e?.message || 'No se pudo revertir el cargo de CxC', 'error')
    }
  }

  // ── Paso 2: cuadre de CxC ────────────────────────────────────────────────
  // Se muestra solo cuando la corrección cambió la parte a crédito y queda deuda
  // o cargo en los libros. Nunca se aplica solo: el operador elige la acción.
  if (paso === 'cuadre' && cuadre) {
    const deudaTrasAbono = Math.max(0, round2(cuadre.deudaCxc - cuadreAbonoMonto))
    const deudaTrasRevertir = Math.max(0, round2(cuadreRevertMonto - cuadre.abonoCxc))
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget && !cuadreOcupado) onClose() }}>
        <div role="dialog" aria-modal="true" aria-label="Cuadre de cuentas por cobrar"
          className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-lg p-4 sm:p-6 max-h-[90vh] flex flex-col gap-4">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                <AlertTriangle size={20} className="text-amber-500" />
              </div>
              <div>
                <h3 className="font-black text-slate-800 text-lg">Cuadre de cuentas por cobrar</h3>
                <p className="text-sm text-slate-500 font-mono">{numDisplay} · <span className="text-emerald-600 font-bold">Corrección guardada ✓</span></p>
              </div>
            </div>
            <button onClick={onClose} disabled={cuadreOcupado}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
            {cuadreListo ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-[11px] text-emerald-800 leading-relaxed">
                  <span className="font-bold">Cuadre registrado ✓</span>{' '}
                  {cuadreListo === 'abono'
                    ? `El abono de ${fmtUsd(cuadreAbonoMonto)} quedó registrado contra la deuda de este despacho.`
                    : `El cargo pasó de ${fmtUsd(cuadre.cargoCxc)} a ${fmtUsd(cuadreRevertMonto)}.`}{' '}
                  Puedes revisar los movimientos en el módulo de Cuentas por Cobrar.
                </div>
              </div>
            ) : (
              <>
                {/* Qué cambió y qué hay en los libros */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Estado de la deuda</p>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    La corrección dejó <span className="font-bold">{fmtUsd(cuadre.cxcEditado)}</span> a crédito
                    (antes {fmtUsd(cuadre.cxcActual)}). En cuentas por cobrar siguen:{' '}
                    cargo {fmtUsd(cuadre.cargoCxc)} · cobrado {fmtUsd(cuadre.abonoCxc)} ·{' '}
                    <span className="font-bold text-amber-700">falta por cobrar {fmtUsd(cuadre.deudaCxc)}</span>.
                  </p>
                  {cuadre.diferencia > 0 && (
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      <span className="font-bold">La deuda en los libros quedó {fmtUsd(cuadre.diferencia)} por encima</span> de
                      la parte a crédito corregida. Puedes cuadrarla ahora o dejarla para después.
                    </p>
                  )}
                  {cuadre.diferencia < 0 && (
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      <span className="font-bold">La parte a crédito aumentó {fmtUsd(-cuadre.diferencia)}.</span> El cargo en
                      cuentas por cobrar quedó corto y no puede aumentarse desde aquí: ajústalo desde el módulo de
                      Cuentas por Cobrar.
                    </p>
                  )}
                </div>

                {/* Opción 1: registrar abono (entra dinero ahora) */}
                {cuadre.deudaCxc > 0 && (
                  <div className={`rounded-xl border p-3 space-y-2 ${cuadreTipo === 'abono' ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
                    <button type="button" onClick={() => setCuadreTipo('abono')} disabled={cuadreOcupado} className="w-full flex items-start gap-2 text-left">
                      <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-600 shrink-0"><ArrowDownCircle size={15} /></span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-slate-700">Registrar abono (el cliente pagó)</span>
                        <span className="block text-[11px] text-slate-500 leading-relaxed">
                          Entra dinero ahora y queda registrado como cobro contra la deuda de este despacho.
                        </span>
                      </span>
                    </button>
                    {cuadreTipo === 'abono' && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 font-medium w-24 shrink-0">Monto USD</span>
                          <div className="relative flex-1 flex items-center">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              aria-label="Monto del abono"
                              value={abonoMonto}
                              onChange={e => setAbonoMonto(e.target.value)}
                              onFocus={e => e.target.select()}
                              placeholder="0.00"
                              className="w-full pl-7 pr-3 py-2 rounded-lg text-sm border border-slate-200 bg-white focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/20"
                              disabled={cuadreOcupado}
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {METODOS_ABONO.map(m => (
                            <button key={m} type="button" onClick={() => setAbonoForma(m)} disabled={cuadreOcupado}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                                abonoForma === m
                                  ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                                  : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
                              }`}>
                              {m}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          aria-label="Referencia del abono"
                          value={abonoReferencia}
                          onChange={e => setAbonoReferencia(e.target.value)}
                          placeholder="Referencia (opcional): folio, comprobante..."
                          maxLength={120}
                          className="w-full px-3 py-2 rounded-lg text-xs border border-slate-200 bg-white focus:outline-none focus:border-emerald-400"
                          disabled={cuadreOcupado}
                        />
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          {cuadre.diferencia > 0
                            ? `Sugerido: ${fmtUsd(Math.min(cuadre.diferencia, cuadre.deudaCxc))}, la diferencia que la corrección quitó de la parte a crédito. `
                            : ''}
                          Con este abono la deuda quedará en {fmtUsd(deudaTrasAbono)}.
                        </p>
                        {!cuadre.clienteId && (
                          <p className="text-[10px] text-red-600 font-semibold">
                            No se identificó el cliente del despacho: registra el abono desde el módulo de Cuentas por Cobrar.
                          </p>
                        )}
                        <button type="button" onClick={handleCuadreAbono} disabled={!abonoValido}
                          className="w-full px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                          {registrarAbono.isPending ? <Loader2 size={16} className="animate-spin" /> : <ArrowDownCircle size={15} />}
                          Registrar abono{cuadreAbonoMonto > 0 ? ` de ${fmtUsd(cuadreAbonoMonto)}` : ''}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Opción 2: revertir el cargo (no mueve dinero) */}
                <div className={`rounded-xl border p-3 space-y-2 ${cuadreTipo === 'revertir' ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200 bg-white'}`}>
                  <button type="button" onClick={() => setCuadreTipo('revertir')} disabled={cuadreOcupado} className="w-full flex items-start gap-2 text-left">
                    <span className="p-1.5 rounded-lg bg-rose-100 text-rose-600 shrink-0"><Undo2 size={15} /></span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-slate-700">Revertir el cargo (fue error de captura)</span>
                      <span className="block text-[11px] text-slate-500 leading-relaxed">
                        No mueve dinero: el cargo baja a lo que realmente quedó a crédito, con motivo y registro en bitácora.
                      </span>
                    </span>
                  </button>
                  {cuadreTipo === 'revertir' && (
                    cuadre.diferencia > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 font-medium w-24 shrink-0">Cargo corregido</span>
                          <div className="relative flex-1 flex items-center">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              aria-label="Monto del cargo corregido"
                              value={revertMonto}
                              onChange={e => setRevertMonto(e.target.value)}
                              onFocus={e => e.target.select()}
                              placeholder="0.00"
                              className="w-full pl-7 pr-3 py-2 rounded-lg text-sm border border-slate-200 bg-white focus:outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400/20"
                              disabled={cuadreOcupado}
                            />
                          </div>
                        </div>
                        <input
                          type="text"
                          aria-label="Motivo de la reversión"
                          value={revertMotivo}
                          onChange={e => setRevertMotivo(e.target.value)}
                          placeholder="Motivo (obligatorio): qué fue lo que se capturó mal"
                          maxLength={200}
                          className="w-full px-3 py-2 rounded-lg text-xs border border-slate-200 bg-white focus:outline-none focus:border-rose-400"
                          disabled={cuadreOcupado}
                        />
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          {cuadreRevertMonto <= 0
                            ? 'El cargo se eliminará por completo. '
                            : `El cargo pasará a ${fmtUsd(cuadreRevertMonto)}. `}
                          La deuda quedará en {fmtUsd(deudaTrasRevertir)}.
                        </p>
                        <button type="button" onClick={handleCuadreRevertir} disabled={!revertValido}
                          className="w-full px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                          {revertirCargo.isPending ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={15} />}
                          Revertir cargo
                        </button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Con esta corrección no hay nada que reducir: el cargo ({fmtUsd(cuadre.cargoCxc)}) ya no supera
                        la parte a crédito corregida ({fmtUsd(cuadre.cxcEditado)}). Solo puede reducirse, nunca aumentarse.
                      </p>
                    )
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={onClose} disabled={cuadreOcupado}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50">
              {cuadreListo ? 'Cerrar' : 'Dejar para después'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label="Editar métodos de pago"
        className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-lg p-4 sm:p-6 max-h-[90vh] flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
              <Pencil size={20} className="text-indigo-500" />
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-lg">Editar métodos de pago</h3>
              <p className="text-sm text-slate-500 font-mono">{numDisplay} · <span className="text-emerald-600 font-bold">Entregado</span></p>
            </div>
          </div>
          <button onClick={onClose} disabled={cargando}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">

          {/* Avisos de seguridad (dinero y comisión) */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
            <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-[11px] text-amber-800 leading-relaxed">
              <span className="font-bold">Este cambio NO mueve dinero.</span> Es corregir cómo quedó
              registrado el pago: si el despacho generó una cuenta por cobrar, la deuda sigue en los
              libros y hay que cuadrarla —después de guardar te lo ofreceremos aquí mismo. La comisión
              del vendedor puede cambiar: revísala después de guardar.
            </div>
          </div>

          {formatoLegado && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-[11px] text-red-700 font-semibold">
              Este despacho tiene el formato de pago antiguo y no puede corregirse desde aquí.
            </div>
          )}

          {/* Distribución actual del despacho (solo lectura): cómo está registrado el pago hoy */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Distribución actual</p>
              <span className="text-sm font-extrabold text-slate-700">Total: ${totalUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>

            {pagosIniciales.map((fp, i) => (
              <div key={`actual-${i}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-slate-600 truncate block">
                    {fp.metodo === 'Saldo a Favor'
                      ? `Saldo a Favor (${(fp.forma_pago_origen || 'Crédito').toUpperCase()})`
                      : fp.metodo}
                  </span>
                  {infoVencimientoCxc(fp) && (
                    <span className="text-[10px] text-slate-400">{infoVencimientoCxc(fp)}</span>
                  )}
                </div>
                <span className="text-sm font-bold text-slate-600 shrink-0">${Number(fp.monto || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            ))}

            {codItems.map((cod, i) => (
              <div key={`cod-${i}`} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="p-1 rounded-lg bg-rose-100 text-rose-600 shrink-0"><Lock size={13} /></span>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-rose-800 block truncate">Cobro a destino (COD)</span>
                      <span className="text-[10px] text-rose-500 font-semibold">
                        {cod.cobro_destino_pagado === true ? 'Pagado ✓' : 'Pendiente de cobro'}
                      </span>
                    </div>
                  </div>
                  <span className="text-sm font-extrabold text-rose-600 shrink-0">${Number(cod.monto || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <p className="text-[10px] text-rose-700/80 leading-relaxed">
                  No se puede modificar desde aquí. Para cobrarlo usa "Marcar COD como pagado"
                  (conciliación con evidencia); para quitarlo, la reversión autorizada.
                </p>
              </div>
            ))}

            {cargoCxc > 0 && (
              <div className="pt-1.5 border-t border-slate-200 text-[10px] text-slate-500 font-semibold flex items-center gap-1 flex-wrap">
                <span>Cuentas por cobrar (CxC): cargo {fmtUsd(cargoCxc)} · cobrado {fmtUsd(abonoCxc)} ·</span>
                {deudaCxc > 0
                  ? <span className="text-amber-700 font-bold">Falta por cobrar {fmtUsd(deudaCxc)}</span>
                  : <span className="text-emerald-600 font-bold">Saldada ✓</span>}
              </div>
            )}

            {pagosIniciales.length === 0 && codItems.length === 0 && (
              <p className="text-xs text-slate-400 italic">Este despacho no tiene métodos de pago registrados.</p>
            )}
          </div>

          {/* Aviso cuando la corrección toca la parte a crédito (CxC) */}
          {cambiaCxc && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2">
              <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="text-[11px] text-amber-800 leading-relaxed">
                <span className="font-bold">Esta corrección cambia la parte a crédito:</span> hoy hay {fmtUsd(cxcActual)}
                en "Cta por cobrar" y quedará {fmtUsd(cxcEditado)}. La deuda en CxC <span className="font-bold">NO se modifica</span>
                con este cambio{deudaCxc > 0 ? `: hoy falta por cobrar ${fmtUsd(deudaCxc)}` : ''}.
                Al guardar podrás cuadrarla aquí mismo: registrar el abono si el cliente pagó, o revertir
                el cargo si la parte a crédito era un error de captura (con su motivo y registro en bitácora).
              </div>
            </div>
          )}

          {/* Métodos de pago editables */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {codItems.length > 0 ? 'Corregir pago inmediato (adelanto)' : 'Corregir formas de pago *'}
            </p>

            <div className="space-y-2">
              {pagos.map(fp => {
                const restante = round2(totalEditable - totalAsignado)
                return (
                  <div key={fp.metodo} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-600 w-28 truncate">
                        {fp.metodo === 'Saldo a Favor'
                          ? `Saldo a Favor (${(fp.forma_pago_origen || 'Crédito').toUpperCase()})`
                          : fp.metodo}
                      </span>
                      <div className="relative flex-1 flex items-center">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          aria-label={`Monto ${fp.metodo}`}
                          value={fp.monto}
                          onChange={e => setMontoForma(fp.metodo, e.target.value)}
                          onFocus={e => e.target.select()}
                          placeholder="0.00"
                          className="w-full pl-7 pr-3 py-2 rounded-lg text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/20 focus:bg-white"
                          disabled={cargando}
                        />
                        {restante > 0.01 && (
                          <button type="button"
                            onClick={() => setMontoForma(fp.metodo, Number(((Number(fp.monto) || 0) + restante).toFixed(2)))}
                            className="ml-1 px-2.5 py-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition-colors shrink-0 whitespace-nowrap"
                            title={`Sumar $${restante.toFixed(2)} restante`}>
                            Resto
                          </button>
                        )}
                      </div>
                      <button type="button"
                        onClick={() => toggleForma(fp.metodo)}
                        disabled={cargando}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                        title="Eliminar forma de pago">
                        <X size={15} />
                      </button>
                    </div>
                    {fp.metodo === 'Cta por cobrar' && (
                      <div className="flex items-center gap-2 pl-28">
                        <span className="text-xs text-slate-500 font-medium">Días venc. (obligatorio) *:</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          aria-label="Días de vencimiento"
                          value={fp.diasVencimiento ?? ''}
                          onChange={e => updateForma(fp.metodo, { diasVencimiento: e.target.value ? parseInt(e.target.value) : null })}
                          placeholder="Obligatorio"
                          className="w-28 px-2 py-1.5 rounded-lg text-xs border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:bg-white"
                          disabled={cargando}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Chips para agregar métodos */}
            <div className="flex flex-wrap gap-2">
              {getSalePaymentMethods()
                .filter(m => !pagos.some(f => f.metodo === m))
                .map(m => (
                  <button key={m} type="button"
                    onClick={() => toggleForma(m)}
                    disabled={cargando}
                    className="px-3 py-2 rounded-lg text-xs font-semibold border bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-all">
                    {m}
                  </button>
                ))}
            </div>

            {/* Cuadre */}
            {pagos.length > 0 && (
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold ${
                pagoCuadrado
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-600 border border-red-200'
              }`}>
                <span>Asignado: ${totalAsignado.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span className="flex items-center gap-1">
                  <DollarSign size={13} />
                  {codItems.length > 0 ? 'Pago inmediato' : 'Total'}: ${totalEditable.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {pagoCuadrado ? (
                  <span className="text-emerald-500">✓</span>
                ) : (
                  <span className="text-red-400">Faltan ${Math.abs(totalEditable - totalAsignado).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                )}
              </div>
            )}
          </div>

          {/* Referencia */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Referencia (opcional)</p>
            <input
              type="text"
              aria-label="Referencia del pago"
              value={referenciaPago}
              onChange={e => setReferenciaPago(e.target.value)}
              placeholder="Ej: referencia de transferencia, folio, etc."
              maxLength={120}
              className="w-full px-3 py-2 rounded-lg text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/20 focus:bg-white"
              disabled={cargando}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 pt-1">
          <button onClick={onClose} disabled={cargando}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleGuardar} disabled={!puedeGuardar || cargando}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {cargando ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={15} />}
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  )
}
