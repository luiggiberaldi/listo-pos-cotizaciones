// Inicio por rol. El DTO del servidor ya excluye la información no autorizada.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutDashboard, DollarSign, TrendingUp, ShieldCheck, RefreshCw, ArrowRight, FileText, Truck, Package, ClipboardList, AlertCircle } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useDashboardMetrics } from '../hooks/useDashboardMetrics'
import { getDashboardAccess } from '../utils/dashboardAccess'
import { fmtUsd } from '../utils/format'
import PageHeader from '../components/ui/PageHeader'

const roleLabels = {
  jefe: 'Dirección · Resultados de la empresa',
  supervisor: 'Supervisión · Resultados de vendedores',
  vendedor: 'Mi actividad · Ventas y comisiones',
  vendedor_sin_comision: 'Mi actividad · Ventas y comisiones',
  administracion: 'Administración · Control operativo',
  logistica: 'Logística · Entregas',
  desarrollador: 'Soporte técnico',
}
const scopeLabels = {
  empresa: 'Toda la empresa', equipo: 'Solo vendedores del equipo', propio: 'Solo mis datos',
  administracion: 'Datos administrativos', logistica: 'Datos de entregas', tecnico: 'Sin métricas financieras',
}

function Stat({ label, value, description, icon: Icon, emphasis = false }) {
  return (
    <div className={`min-w-0 rounded-2xl border p-4 sm:p-5 ${emphasis ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs sm:text-sm font-semibold text-slate-600">{label}</p>
        <span className={`rounded-lg p-2 ${emphasis ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}><Icon size={17} aria-hidden="true" /></span>
      </div>
      <p className="mt-3 break-words text-2xl sm:text-3xl font-black tracking-tight text-slate-900">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">{description}</p>
    </div>
  )
}

function Panel({ title, description, children, action }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
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
  const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600'

  return (
    <main aria-label="Inicio por rol" className="mx-auto w-full max-w-7xl space-y-5 p-3 sm:p-5 lg:p-6">
      <PageHeader icon={LayoutDashboard} title="Inicio" subtitle={roleLabels[perfil?.rol] || 'Acceso restringido'}
        action={access.quote ? <button type="button" className={buttonClass} onClick={() => navigate('/cotizaciones?nueva=1')}><FileText size={15} />Nueva cotización</button> : null} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><ShieldCheck size={16} className="text-emerald-700" /><span>{scopeLabels[access.scope] || 'Sin acceso a datos'}{perfil?.nombre ? ` · ${perfil.nombre}` : ''}</span></div>
        {access.sales && <label className="flex items-center gap-2 text-xs font-medium text-slate-600">Período
          <select aria-label="Período del resumen" value={periodo} onChange={event => setPeriodo(event.target.value)} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800">
            <option value="mes">Este mes</option><option value="anterior">Mes anterior</option><option value="historico">Todo el historial</option>
          </select>
        </label>}
      </div>
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
      {isLoading && <div role="status" aria-label="Cargando resumen" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map(item => <div key={item} className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />)}</div>}
      {data && (
        <>
          {access.sales && (
            <>
              <div className={`grid gap-4 sm:grid-cols-2 ${company ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
                {company && <Stat label="Ganancia bruta estimada de la empresa" value={data.gananciasEmpresa?.brutaEstimadaUsd == null ? 'No disponible' : fmtUsd(data.gananciasEmpresa.brutaEstimadaUsd)}
                  description={data.gananciasEmpresa?.despachosSinCosto ? `${data.gananciasEmpresa.despachosSinCosto} despachos sin costo completo. No se inventa un total.` : 'Estimación con costos actuales; no es utilidad neta.'} icon={TrendingUp} emphasis />}
                <Stat label={own ? 'Mis ventas' : team ? 'Ventas de vendedores' : 'Ventas de la empresa'} value={fmtUsd(data.ventas.totalUsd)} description={`${data.period.label} · Despachos aprobados y entregados`} icon={DollarSign} />
                <Stat label={own ? 'Mis comisiones generadas' : company ? 'Comisiones generadas' : 'Comisiones de vendedores'} value={fmtUsd(data.comisiones.totalUsd)} description={data.comisiones.sinComisionConfigurada ? 'Perfil sin comisión regular. Se conserva el historial generado.' : `${data.period.label} · Comisiones netas registradas, sin flujo de pago interno`} icon={TrendingUp} />
                <Stat label={own ? 'Mis ventas registradas' : 'Despachos de venta'} value={data.ventas.despachos} description="Cada despacho se cuenta una vez; no se cuentan cotizaciones ni filas de comisión como ventas." icon={ClipboardList} />
              </div>
              {company && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900"><strong>Cómo se calcula:</strong> {data.gananciasEmpresa.descripcion} Para ver el acumulado empresarial, selecciona «Todo el historial».</div>}
              {access.team && (
                <Panel title="Resultados por vendedor" description="Ventas atribuidas al vendedor del despacho; ganancias del vendedor mostradas como comisiones generadas. No incluye resultados de jefes ni de administración.">
                  {data.equipo.length === 0 ? <p className="py-5 text-sm text-slate-500">No hay vendedores registrados en este equipo.</p> : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead className="bg-slate-50 text-xs text-slate-600"><tr><th scope="col" className="p-3 text-left">Vendedor</th><th scope="col" className="p-3 text-right">Ventas</th><th scope="col" className="p-3 text-right">Despachos</th><th scope="col" className="p-3 text-right">Comisiones</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">{data.equipo.map(seller => <tr key={seller.id}>
                          <th scope="row" className="p-3 text-left font-normal"><div className="flex items-center gap-2"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: seller.color }} /><span className="font-semibold text-slate-800">{seller.nombre}</span></div><p className="mt-1 pl-4 text-xs text-slate-500">{seller.activo ? 'Activo' : 'Inactivo'}{seller.externo ? ' · Externo' : seller.rol === 'vendedor_sin_comision' ? ' · Sin comisión regular' : ''}</p></th>
                          <td className="p-3 text-right font-semibold tabular-nums text-slate-800">{fmtUsd(seller.ventasUsd)}</td><td className="p-3 text-right tabular-nums text-slate-600">{seller.despachos}</td><td className="p-3 text-right font-semibold tabular-nums text-emerald-800">{fmtUsd(seller.comisionesUsd)}</td>
                        </tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              )}
              <Panel title={own ? 'Mis últimas ventas' : team ? 'Últimas ventas de vendedores' : 'Últimas ventas de la empresa'} description="Se excluyen pendientes, anuladas, donaciones y préstamos; la fecha corresponde al despacho."
                action={<button type="button" className={buttonClass} onClick={() => navigate('/despachos')}>Ver despachos <ArrowRight size={14} /></button>}>
                {data.ultimasVentas.length === 0 ? <p className="py-5 text-sm text-slate-500">No hay ventas en este período.</p> : <div className="divide-y divide-slate-100">{data.ultimasVentas.map(sale => <div key={sale.id} className="flex items-center justify-between gap-3 py-3">
                  <div><p className="text-sm font-semibold text-slate-800">DES-{String(sale.numero).padStart(5, '0')}</p><p className="mt-1 text-xs text-slate-500">{formatDate(sale.fecha)} · {sale.estado === 'entregada' ? 'Entregada' : 'Despachada'}</p></div><p className="text-sm font-bold tabular-nums text-slate-800">{fmtUsd(sale.totalUsd)}</p>
                </div>)}</div>}
              </Panel>
            </>
          )}
          {(access.operations || access.deliveries) && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Stat label={access.deliveries ? 'Entregas pendientes' : 'Despachos por aprobar'} value={data.operaciones.pendientes} description="Pendientes actuales de tu área" icon={Truck} />
                {access.deliveries && <Stat label="Entregadas hoy" value={data.operaciones.entregadasHoy} description="Día local de Venezuela" icon={ClipboardList} />}
                {access.receivables && <Stat label="Cuentas por cobrar" value={fmtUsd(data.operaciones.cuentasPorCobrar.totalUsd)} description={`${data.operaciones.cuentasPorCobrar.clientes} clientes con saldo pendiente`} icon={AlertCircle} />}
                {access.inventory && <Stat label="Inventario bajo stock" value={data.operaciones.stockBajo} description="Productos activos que requieren reposición" icon={Package} />}
              </div>
              <Panel title={access.deliveries ? 'Próximas entregas' : 'Despachos por aprobar'} description="Prioridad a los pendientes más antiguos. Sin ganancias ni comisiones de vendedores."
                action={<button type="button" className={buttonClass} onClick={() => navigate('/despachos')}>Ver todos <ArrowRight size={14} /></button>}>
                {!data.operaciones.despachos.length ? <p className="py-5 text-sm text-slate-500">No hay despachos pendientes.</p> : <div className="divide-y divide-slate-100">{data.operaciones.despachos.map(dispatch => <div key={dispatch.id} className="flex items-start justify-between gap-3 py-3">
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
