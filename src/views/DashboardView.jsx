// Inicio por rol. El DTO del servidor ya excluye la información no autorizada.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutDashboard, DollarSign, TrendingUp, RefreshCw, ArrowRight, FileText, Truck, Package, ClipboardList, AlertCircle } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useDashboardMetrics } from '../hooks/useDashboardMetrics'
import { getDashboardAccess } from '../utils/dashboardAccess'
import { fmtUsd } from '../utils/format'
import PageHeader from '../components/ui/PageHeader'
import CustomSelect from '../components/ui/CustomSelect'
import MetricCard from '../components/ui/MetricCard'

const roleLabels = {
  jefe: 'Dirección · Resultados de la empresa',
  supervisor: 'Supervisión · Resultados de vendedores',
  vendedor: 'Mi actividad · Ventas y comisiones',
  vendedor_sin_comision: 'Mi actividad · Ventas y comisiones',
  administracion: 'Administración · Control operativo',
  logistica: 'Logística · Entregas',
  desarrollador: 'Soporte técnico',
}
const PERIOD_OPTIONS = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'mes', label: 'Este mes' },
  { value: 'anterior', label: 'Mes anterior' },
  { value: 'historico', label: 'Todo el historial' },
]

const PANEL_TONES = {
  slate: 'border-slate-200 border-l-slate-300',
  indigo: 'border-indigo-200/80 border-l-indigo-500',
  sky: 'border-sky-200/80 border-l-sky-500',
  amber: 'border-amber-200/80 border-l-amber-500',
}

const ROLE_BADGES = {
  supervisor: 'bg-amber-100 text-amber-800 border-amber-200',
  vendedor: 'bg-blue-100 text-blue-800 border-blue-200',
}

function SellerRoleBadge({ seller }) {
  const role = seller.rol === 'supervisor' ? 'Supervisor' : 'Vendedor'
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${ROLE_BADGES[seller.rol] || ROLE_BADGES.vendedor}`}>{role}</span>
}

function Panel({ title, description, children, action, tone = 'slate' }) {
  return (
    <section aria-label={title} className={`min-w-0 rounded-2xl border border-l-4 bg-white p-4 sm:p-5 ${PANEL_TONES[tone] || PANEL_TONES.slate}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-bold text-slate-800">{title}</h2>{description && <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  )
}

const formatDate = value => new Date(value).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', timeZone: 'America/Caracas' })

export default function DashboardView() {
  const perfil = useAuthStore(state => state.perfil)
  const navigate = useNavigate()
  const [periodo, setPeriodo] = useState('mes')
  const access = getDashboardAccess(perfil?.rol)
  const { data, isLoading, isFetching, isError, error, refetch, accessReady } = useDashboardMetrics(periodo)
  const own = access.scope === 'propio'
  const company = access.scope === 'empresa'
  const team = access.scope === 'equipo'
  const administration = access.scope === 'administracion'
  const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600'

  return (
    <main aria-label="Inicio por rol" className="mx-auto w-full max-w-[1700px] space-y-5 p-3 sm:p-5 lg:p-6 2xl:px-10">
      <PageHeader icon={LayoutDashboard} title="Inicio" subtitle={roleLabels[perfil?.rol] || 'Acceso restringido'}
        action={access.quote ? <button type="button" className={buttonClass} onClick={() => navigate('/cotizaciones?nueva=1')}><FileText size={15} />Nueva cotización</button> : null} />
      {access.sales && <div className="flex justify-end items-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">Período
          <span className="w-44"><CustomSelect
            options={PERIOD_OPTIONS}
            value={periodo}
            onChange={setPeriodo}
            placeholder="Período"
            searchable={false}
          /></span>
        </label>
      </div>}
      {!accessReady && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-semibold">Los datos están protegidos.</p>
          <p className="mt-1">Conéctate y vuelve a introducir tu PIN para consultar la información autorizada. No se muestran cifras de otra sesión.</p>
          <button type="button" className={`${buttonClass} mt-3`} onClick={() => useAuthStore.getState().switchOut()}>Validar mi acceso</button>
        </div>
      )}
      {isError && accessReady && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{error?.message || 'No se pudo cargar el resumen. No se muestran cifras parciales.'}</p>
          <button type="button" onClick={() => refetch()} className={buttonClass}><RefreshCw size={14} />Reintentar</button>
        </div>
      )}
      {isLoading && <div role="status" aria-label="Cargando resumen" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[
        ['#1B365D', '#0d1f3c'], ['#065f46', '#047857'], ['#1d4ed8', '#1e40af'],
      ].map(([from, to]) => <div key={from} className="h-36 animate-pulse rounded-2xl border border-white/10 shadow-sm" style={{ background: `linear-gradient(135deg, ${from}22 0%, ${to}18 100%)` }} />)}</div>}
      {data && (
        <>
          {access.sales && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard color="primary" icon={DollarSign} label={own ? 'Mis ventas' : team ? 'Ventas de vendedores' : 'Ventas de la empresa'} value={fmtUsd(data.ventas.totalUsd)} sub={`${data.period.label} · Despachos aprobados y entregados`} />
                <MetricCard color="emerald" icon={TrendingUp} label={own ? 'Mis comisiones generadas' : company ? 'Comisiones generadas' : 'Comisiones de vendedores'} value={fmtUsd(data.comisiones.totalUsd)} sub={data.comisiones.sinComisionConfigurada ? 'Perfil sin comisión regular. Se conserva el historial generado.' : `${data.period.label} · Comisiones netas registradas, sin flujo de pago interno`} />
                <MetricCard color="blue" icon={ClipboardList} label={own ? 'Mis ventas registradas' : 'Despachos de venta'} value={data.ventas.despachos} sub="Cada despacho se cuenta una vez; no se cuentan cotizaciones ni filas de comisión como ventas." />
              </div>
              {access.team && (
                <Panel tone="indigo" title="Resultados por vendedor" description="Ventas atribuidas al vendedor del despacho; ganancias mostradas como comisiones generadas. Solo personal de ventas activo (vendedores y supervisores).">
                  {data.equipo.length === 0 ? <p className="py-5 text-sm text-slate-500">No hay vendedores registrados en este equipo.</p> : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead className="bg-slate-50 text-xs text-slate-600"><tr><th scope="col" className="p-3 text-left">Vendedor</th><th scope="col" className="p-3 text-right">Ventas</th><th scope="col" className="p-3 text-right">Despachos</th><th scope="col" className="p-3 text-right">Comisiones</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">{data.equipo.map(seller => <tr key={seller.id}>
                          <th scope="row" className="border-l-4 p-3 text-left font-normal" style={{ borderLeftColor: seller.color }}><div className="flex flex-wrap items-center gap-2"><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm" style={{ background: seller.color }} /><span className="font-semibold text-slate-800">{seller.nombre}</span><SellerRoleBadge seller={seller} /></div><p className="mt-1 pl-5 text-xs text-slate-500">{seller.externo ? 'Externo' : 'Activo'}</p></th>
                          <td className="p-3 text-right font-semibold tabular-nums text-slate-800">{fmtUsd(seller.ventasUsd)}</td><td className="p-3 text-right tabular-nums text-slate-600">{seller.despachos}</td><td className="p-3 text-right font-semibold tabular-nums text-emerald-800">{fmtUsd(seller.comisionesUsd)}</td>
                        </tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              )}
              <Panel tone="sky" title={own ? 'Mis últimas ventas' : team ? 'Últimas ventas de vendedores' : 'Últimas ventas de la empresa'} description="Se excluyen pendientes, anuladas, donaciones y préstamos; la fecha corresponde al despacho."
                action={<button type="button" className={buttonClass} onClick={() => navigate('/despachos')}>Ver despachos <ArrowRight size={14} /></button>}>
                {data.ultimasVentas.length === 0 ? <p className="py-5 text-sm text-slate-500">No hay ventas en este período.</p> : <div className="divide-y divide-slate-100">{data.ultimasVentas.map(sale => <div key={sale.id} className="flex items-center justify-between gap-3 py-3">
                  <div><p className="text-sm font-semibold text-slate-800">DES-{String(sale.numero).padStart(5, '0')}</p><p className="mt-1 text-xs text-slate-500">{formatDate(sale.fecha)} · {sale.estado === 'entregada' ? 'Entregada' : 'Despachada'}</p></div><p className="text-sm font-bold tabular-nums text-slate-800">{fmtUsd(sale.totalUsd)}</p>
                </div>)}</div>}
              </Panel>
            </>
          )}
          {(access.operations || access.deliveries) && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard color="gold" icon={Truck} label={administration ? 'Despachos por aprobar hoy' : access.deliveries ? 'Entregas pendientes' : 'Despachos por aprobar'} value={data.operaciones.pendientes} sub={administration ? 'Creados hoy · requieren aprobación' : 'Pendientes actuales de tu área'} />
                {access.deliveries && <MetricCard color="emerald" icon={ClipboardList} label="Entregadas hoy" value={data.operaciones.entregadasHoy} sub="Día local de Venezuela" />}
                {administration && <MetricCard color="blue" icon={AlertCircle} label="COD pendientes" value={fmtUsd(data.operaciones.codPendientes.totalUsd)} sub={`${data.operaciones.codPendientes.cantidad} cobros a destino abiertos`} />}
                {administration && <MetricCard color="gold" icon={AlertCircle} label="Deudas por vencer" value={fmtUsd(data.operaciones.deudasPorVencer.totalUsd)} sub={`${data.operaciones.deudasPorVencer.cantidad} cuentas · próximos 7 días`} />}
                {!administration && access.receivables && <MetricCard color="blue" icon={AlertCircle} label="Cuentas por cobrar" value={fmtUsd(data.operaciones.cuentasPorCobrar.totalUsd)} sub={`${data.operaciones.cuentasPorCobrar.clientes} clientes con saldo pendiente`} />}
                {access.inventory && <MetricCard color="gold" icon={Package} label="Inventario bajo stock" value={data.operaciones.stockBajo} sub="Productos activos que requieren reposición" />}
              </div>
              <Panel tone="amber" title={administration ? 'Despachos por aprobar hoy' : access.deliveries ? 'Próximas entregas' : 'Despachos por aprobar'} description={administration ? 'Solo se muestran despachos en estado pendiente creados durante el día de hoy.' : 'Prioridad a los pendientes más antiguos. Sin ganancias ni comisiones de vendedores.'}
                action={<button type="button" className={buttonClass} onClick={() => navigate('/despachos')}>Ver todos <ArrowRight size={14} /></button>}>
                {!data.operaciones.despachos.length ? <p className="py-5 text-sm text-slate-500">{administration ? 'No hay despachos por aprobar hoy.' : 'No hay despachos pendientes.'}</p> : <div className="divide-y divide-slate-100">{data.operaciones.despachos.map(dispatch => <div key={dispatch.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0"><p className="font-semibold text-slate-800">DES-{String(dispatch.numero).padStart(5, '0')}</p><p className="mt-1 break-words text-sm text-slate-600">{dispatch.cliente}</p>{dispatch.ubicacion && <p className="text-xs text-slate-500">{dispatch.ubicacion}</p>}</div><span className="shrink-0 text-xs text-slate-500">{formatDate(dispatch.fecha)}</span>
                </div>)}</div>}
              </Panel>
            </>
          )}
          {access.scope === 'tecnico' && <Panel title="Acceso técnico" description="El rol de soporte no hereda automáticamente las métricas financieras de dirección."><p className="text-sm text-slate-600">Utiliza las herramientas técnicas autorizadas desde el menú. Para consultar resultados empresariales, inicia sesión con un perfil de jefe.</p></Panel>}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><span>Actualizado: {new Date(data.actualizadoEn).toLocaleString('es-VE', { timeZone: 'America/Caracas' })} · USD</span><button type="button" disabled={isFetching} onClick={() => refetch()} className={buttonClass}><RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />{isFetching ? 'Actualizando' : 'Actualizar'}</button></div>
        </>
      )}
    </main>
  )
}
