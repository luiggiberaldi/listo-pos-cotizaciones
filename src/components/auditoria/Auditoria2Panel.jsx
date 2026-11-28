// src/components/auditoria/Auditoria2Panel.jsx
// Panel de Auditoría 2.0 (OP-2026-110):
//  - Alertas críticas recientes + verificación de sello anti-alteración (SHA-256)
//  - Vista "Cambios (Antes / Después)" (Capa 1) con filtro de "Cambios fuera de la app"
//  - Vista "Accesos y Errores (Portero)" (Capa 2, solo jefe/administración/desarrollador)
//  - Modal "Ver historia" por registro y exportación a CSV (Excel)
import { useState } from 'react'
import {
  ShieldCheck, AlertTriangle, History, Activity, Download,
  ChevronLeft, ChevronRight, X, Loader2, CheckCircle2, Lock
} from 'lucide-react'
import {
  useAuditoriaStats,
  useAuditoriaCambios,
  useAuditoriaPeticiones,
  useAuditoriaHistoria,
} from '../../hooks/useAuditoria'
import { authFetch } from '../../services/authFetch'
import useAuthStore from '../../store/useAuthStore'
import { showToast } from '../ui/Toast'

const TABLAS_OPCIONES = [
  { valor: '', label: 'Todas las tablas' },
  { valor: 'notas_despacho', label: 'Despachos' },
  { valor: 'cotizaciones', label: 'Cotizaciones' },
  { valor: 'cuentas_por_cobrar', label: 'Cuentas por Cobrar' },
  { valor: 'clientes', label: 'Clientes' },
  { valor: 'productos', label: 'Productos / Precios' },
  { valor: 'inventario_movimientos', label: 'Inventario (Kardex)' },
  { valor: 'comisiones', label: 'Comisiones' },
  { valor: 'usuarios', label: 'Usuarios' },
  { valor: 'transportistas', label: 'Transportistas' },
  { valor: 'pagos_transportistas', label: 'Pagos a Transportistas' },
  { valor: 'vehiculos', label: 'Vehículos' },
  { valor: 'configuracion_negocio', label: 'Configuración' },
]

const ORIGEN_BADGE = {
  app:     { label: 'App',            cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cron:    { label: 'Automático',     cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  sistema: { label: 'Sistema',        cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  manual:  { label: 'Fuera de la app',cls: 'bg-rose-50 text-rose-700 border-rose-200 font-semibold' },
}

function fmtVal(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function fmtFechaHora(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('es-VE', { timeZone: 'America/Caracas', dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return String(ts)
  }
}

export function exportarCsvAuditoria(filas, nombreArchivo) {
  if (!Array.isArray(filas) || filas.length === 0) {
    showToast('No hay registros para exportar', 'info')
    return
  }
  const cols = Object.keys(filas[0])
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [cols.join(','), ...filas.map((f) => cols.map((c) => esc(typeof f[c] === 'object' ? JSON.stringify(f[c]) : f[c])).join(','))].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nombreArchivo}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function HistoriaEntidadModal({ tabla, id, onClose }) {
  const { data, isLoading } = useAuditoriaHistoria({ tabla, id, enabled: Boolean(id) })
  if (!id) return null

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-sky-600" />
            <div>
              <h3 className="font-semibold text-slate-900">Historia del registro</h3>
              <p className="text-xs text-slate-500">{tabla || 'entidad'} · {id}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-slate-500 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando historia…
            </div>
          ) : !data?.lineaTiempo?.length ? (
            <p className="text-sm text-slate-500 text-center py-8">Sin eventos registrados para este elemento.</p>
          ) : (
            data.lineaTiempo.map((ev, i) => (
              <div key={`${ev.fuente}-${ev.id}-${i}`} className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/50">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 mb-1.5">
                  <span className="font-semibold text-slate-800">
                    {ev.fuente === 'cambio' ? `${ev.tipo} en ${ev.tabla}` : ev.accion}
                  </span>
                  <span>{fmtFechaHora(ev.ts)} · {ev.operador_nombre || ev.usuario_nombre || 'Sistema'}</span>
                </div>
                {ev.fuente === 'bitacora' && ev.descripcion && (
                  <p className="text-sm text-slate-700">{ev.descripcion}</p>
                )}
                {ev.fuente === 'cambio' && ev.cambios && (
                  <div className="mt-1 space-y-1 text-xs">
                    {Object.entries(ev.cambios).map(([campo, diff]) => (
                      <div key={campo} className="flex flex-wrap gap-1.5 items-baseline">
                        <span className="font-mono text-slate-600">{campo}:</span>
                        <span className="line-through text-rose-600">{fmtVal(diff?.antes)}</span>
                        <span className="text-slate-400">→</span>
                        <span className="font-medium text-emerald-700">{fmtVal(diff?.despues)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default function Auditoria2Panel({ tabActiva, onCambiarTab }) {
  const { perfil } = useAuthStore()
  const esFinanzas = ['jefe', 'administracion', 'desarrollador'].includes(perfil?.rol)
  const { data: stats } = useAuditoriaStats()

  const [pagCambios, setPagCambios] = useState(0)
  const [tabla, setTabla] = useState('')
  const [origen, setOrigen] = useState('')
  const [historia, setHistoria] = useState(null)

  const [pagPet, setPagPet] = useState(0)
  const [resPet, setResPet] = useState('')
  const [verificandoSello, setVerificandoSello] = useState(false)
  const [estadoSello, setEstadoSello] = useState(null)

  const { data: cambiosData, isLoading: cargandoCambios } = useAuditoriaCambios({
    pagina: pagCambios, porPagina: 30, tabla, origen,
  })
  const { data: petData, isLoading: cargandoPet } = useAuditoriaPeticiones({
    pagina: pagPet, porPagina: 30, resultado: resPet,
  })

  async function verificarSellos() {
    setVerificandoSello(true)
    try {
      const r = await authFetch('/api/admin/audit/verificar-cadena')
      const d = await r.json()
      setEstadoSello(d)
      showToast(d?.ok ? `Sellos íntegros (${d.revisadas} revisados)` : 'Alerta: se detectó una ruptura en la cadena', d?.ok ? 'success' : 'error')
    } catch {
      showToast('No se pudo verificar la cadena de sellos', 'error')
    } finally {
      setVerificandoSello(false)
    }
  }

  return (
    <div className="space-y-4 mb-5">
      {/* Barra de pestañas Auditoría 2.0 + Sello anti-alteración */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-2xl p-2 shadow-xs">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onCambiarTab('bitacora')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition ${tabActiva === 'bitacora' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Bitácora del negocio
          </button>
          <button
            onClick={() => onCambiarTab('cambios')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${tabActiva === 'cambios' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <History className="w-3.5 h-3.5" /> Cambios (Antes / Después)
          </button>
          {esFinanzas && (
            <button
              onClick={() => onCambiarTab('peticiones')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${tabActiva === 'peticiones' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <Activity className="w-3.5 h-3.5" /> Accesos y Errores
              {stats?.peticionesAlerta7d > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-rose-500 text-white">{stats.peticionesAlerta7d}</span>
              )}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!esFinanzas && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600">
              <Lock className="w-3 h-3" /> Vista operativa (sin precios ni dinero)
            </span>
          )}
          {esFinanzas && (
            <button
              onClick={verificarSellos}
              disabled={verificandoSello}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-50"
            >
              {verificandoSello ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              {estadoSello ? (estadoSello.ok ? `Sellos OK (${estadoSello.revisadas})` : 'Cadena rota') : 'Verificar sellos'}
            </button>
          )}
        </div>
      </div>

      {/* Alertas críticas recientes */}
      {stats?.alertasRecientes?.length > 0 && tabActiva === 'bitacora' && (
        <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 mb-2">
            <AlertTriangle className="w-4 h-4" />
            Alertas críticas de los últimos 7 días ({stats.alertasRecientes.length})
            {stats.cambiosFueraApp7d > 0 && (
              <span className="ml-auto px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                {stats.cambiosFueraApp7d} cambio(s) fuera de la app
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {stats.alertasRecientes.slice(0, 4).map((a) => (
              <div key={a.id} className="text-xs bg-white border border-amber-200/80 rounded-lg px-2.5 py-1.5 text-slate-700">
                <span className="font-semibold text-amber-900">{a.titulo_es || a.accion}</span> · {a.usuario_nombre || 'Sistema'} · {fmtFechaHora(a.ts)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pestaña: Cambios (Antes / Después) */}
      {tabActiva === 'cambios' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <select
                value={tabla}
                onChange={(e) => { setTabla(e.target.value); setPagCambios(0) }}
                className="text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50"
              >
                {TABLAS_OPCIONES.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
              </select>
              <select
                value={origen}
                onChange={(e) => { setOrigen(e.target.value); setPagCambios(0) }}
                className="text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50"
              >
                <option value="">Todos los orígenes</option>
                <option value="app">Desde la app</option>
                <option value="manual">Fuera de la app (manual)</option>
                <option value="cron">Proceso automático</option>
                <option value="sistema">Sistema</option>
              </select>
            </div>
            <button
              onClick={() => exportarCsvAuditoria(cambiosData?.cambios || [], 'auditoria_cambios')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700"
            >
              <Download className="w-3.5 h-3.5" /> Exportar Excel (CSV)
            </button>
          </div>

          {cargandoCambios ? (
            <div className="py-10 text-center text-sm text-slate-500">Cargando cambios…</div>
          ) : !cambiosData?.cambios?.length ? (
            <div className="py-10 text-center text-sm text-slate-500">No hay cambios grabados con estos filtros todavía.</div>
          ) : (
            <div className="space-y-2.5">
              {cambiosData.cambios.map((c) => {
                const badge = ORIGEN_BADGE[c.origen] || ORIGEN_BADGE.sistema
                return (
                  <div key={c.id} className="border border-slate-200 rounded-xl p-3.5 hover:bg-slate-50/70 transition">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold px-2 py-0.5 rounded-md bg-slate-900 text-white">{c.tipo}</span>
                        <span className="font-semibold text-slate-800">{c.tabla}</span>
                        <span className={`px-2 py-0.5 rounded-md border text-[11px] ${badge.cls}`}>{badge.label}</span>
                        <span className="text-slate-500">{c.operador_nombre || 'Sistema'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>{fmtFechaHora(c.ts)}</span>
                        {c.registro_id && (
                          <button
                            onClick={() => setHistoria({ tabla: c.tabla, id: c.registro_id })}
                            className="text-sky-600 hover:underline font-medium"
                          >
                            Ver historia
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-1 text-xs">
                      {Object.entries(c.cambios || {}).slice(0, 8).map(([campo, diff]) => (
                        <div key={campo} className="flex flex-wrap gap-1.5 items-baseline">
                          <span className="font-mono text-slate-500">{campo}:</span>
                          <span className="line-through text-rose-600">{fmtVal(diff?.antes)}</span>
                          <span className="text-slate-400">→</span>
                          <span className="font-medium text-emerald-700">{fmtVal(diff?.despues)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {(cambiosData?.pages || 0) > 1 && (
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-600">
              <span>Página {pagCambios + 1} de {cambiosData.pages} ({cambiosData.total} registros)</span>
              <div className="flex gap-1.5">
                <button disabled={pagCambios === 0} onClick={() => setPagCambios((p) => p - 1)} className="p-1.5 rounded-lg border disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
                <button disabled={pagCambios + 1 >= cambiosData.pages} onClick={() => setPagCambios((p) => p + 1)} className="p-1.5 rounded-lg border disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pestaña: Accesos y Errores (Portero) */}
      {tabActiva === 'peticiones' && esFinanzas && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={resPet}
              onChange={(e) => { setResPet(e.target.value); setPagPet(0) }}
              className="text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50"
            >
              <option value="">Todos los resultados</option>
              <option value="denegado">Sin permiso (401 / 403)</option>
              <option value="error">Errores (500)</option>
              <option value="ok">Correctas (200 / 201)</option>
            </select>
            <button
              onClick={() => exportarCsvAuditoria(petData?.peticiones || [], 'auditoria_portero')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700"
            >
              <Download className="w-3.5 h-3.5" /> Exportar Excel (CSV)
            </button>
          </div>

          {cargandoPet ? (
            <div className="py-10 text-center text-sm text-slate-500">Cargando registro del portero…</div>
          ) : !petData?.peticiones?.length ? (
            <div className="py-10 text-center text-sm text-slate-500">Sin peticiones registradas todavía.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2 pr-3">Fecha</th>
                    <th className="py-2 pr-3">Operación</th>
                    <th className="py-2 pr-3">Estado</th>
                    <th className="py-2 pr-3">Usuario</th>
                    <th className="py-2">Tiempo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {petData.peticiones.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-500">{fmtFechaHora(p.ts)}</td>
                      <td className="py-2 pr-3 font-mono text-slate-800">{p.metodo} {p.ruta}</td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded-full font-semibold ${p.resultado === 'ok' ? 'bg-emerald-50 text-emerald-700' : p.resultado === 'denegado' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                          {p.status} · {p.resultado}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-slate-700">{p.usuario_nombre || 'Sin sesión'}</td>
                      <td className="py-2 text-slate-500">{p.duracion_ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {historia && (
        <HistoriaEntidadModal tabla={historia.tabla} id={historia.id} onClose={() => setHistoria(null)} />
      )}
    </div>
  )
}
