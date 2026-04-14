// src/views/AuditoriaView.jsx
// Historial de acciones del sistema — solo supervisor
import { useState } from 'react'
import { ClipboardList, RefreshCw, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import { useAuditoria }  from '../hooks/useAuditoria'
import { useUsuarios }   from '../hooks/useUsuarios'
import CustomSelect from '../components/ui/CustomSelect'
import Skeleton from '../components/ui/Skeleton'

// ─── Colores por categoría ────────────────────────────────────────────────────
const CATEGORIA_ESTILOS = {
  cotizacion:   'bg-amber-50 text-amber-700 border-amber-200',
  cliente:      'bg-blue-50 text-blue-700 border-blue-200',
  inventario:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  usuario:      'bg-purple-50 text-purple-700 border-purple-200',
  reasignacion: 'bg-orange-50 text-orange-700 border-orange-200',
  sistema:      'bg-slate-100 text-slate-600 border-slate-200',
}

const CATEGORIA_LABELS = {
  cotizacion:   'Cotización',
  cliente:      'Cliente',
  inventario:   'Inventario',
  usuario:      'Usuario',
  reasignacion: 'Reasignación',
  sistema:      'Sistema',
}

const CATEGORIAS_FILTRO = [
  { valor: '', label: 'Todas las categorías' },
  { valor: 'cotizacion',   label: 'Cotizaciones' },
  { valor: 'cliente',      label: 'Clientes' },
  { valor: 'inventario',   label: 'Inventario' },
  { valor: 'usuario',      label: 'Usuarios' },
  { valor: 'reasignacion', label: 'Reasignaciones' },
]

function CategoriaBadge({ categoria }) {
  const estilos = CATEGORIA_ESTILOS[categoria] ?? CATEGORIA_ESTILOS.sistema
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full border ${estilos}`}>
      {CATEGORIA_LABELS[categoria] ?? categoria}
    </span>
  )
}

function fmtFechaHora(f) {
  if (!f) return '—'
  const d = new Date(f)
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
}
function SkeletonAuditoria() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-slate-100 p-3 flex gap-3 items-center">
          <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/3 rounded" />
            <Skeleton className="h-3 w-2/3 rounded" />
          </div>
          <Skeleton className="h-3 w-24 rounded" />
        </div>
      ))}
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
const POR_PAGINA = 50

export default function AuditoriaView() {
  const [pagina,     setPagina]     = useState(0)
  const [usuarioId,  setUsuarioId]  = useState('')
  const [categoria,  setCategoria]  = useState('')

  const { data, isLoading, isError, refetch } = useAuditoria({ pagina, porPagina: POR_PAGINA, usuarioId, categoria })
  const { data: usuarios = [] } = useUsuarios()

  const registros = data?.registros ?? []
  const total     = data?.total ?? 0
  const totalPags = Math.ceil(total / POR_PAGINA)

  function cambiarFiltro(fn) {
    fn()
    setPagina(0)
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-screen-xl">

      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-light rounded-xl flex items-center justify-center">
            <ClipboardList size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Auditoría</h1>
            <p className="text-sm text-slate-500">
              {isLoading ? 'Cargando...' : `${total.toLocaleString()} registro${total !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        <button onClick={() => refetch()}
          className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors self-start sm:self-auto">
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <Filter size={14} className="text-slate-400 shrink-0" />
        {/* Filtro por categoría */}
        <div className="min-w-[180px]">
          <CustomSelect
            options={CATEGORIAS_FILTRO.map(({ valor, label }) => ({ value: valor, label }))}
            value={categoria}
            onChange={val => cambiarFiltro(() => setCategoria(val))}
            placeholder="Todas las categorías"
            searchable={false}
          />
        </div>
        {/* Filtro por usuario */}
        <div className="min-w-[180px]">
          <CustomSelect
            options={[
              { value: '', label: 'Todos los usuarios' },
              ...usuarios.map(u => ({ value: u.id, label: u.nombre })),
            ]}
            value={usuarioId}
            onChange={val => cambiarFiltro(() => setUsuarioId(val))}
            placeholder="Todos los usuarios"
          />
        </div>
        {(categoria || usuarioId) && (
          <button onClick={() => { setCategoria(''); setUsuarioId(''); setPagina(0) }}
            className="text-xs text-slate-500 hover:text-slate-800 underline">
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Tabla */}
      {isLoading ? (
        <SkeletonAuditoria />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar registros</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : registros.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
          <ClipboardList size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin registros</p>
          <p className="text-sm mt-1">No hay actividad que coincida con los filtros.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wide w-36">Fecha</th>
                  <th className="text-left py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wide">Usuario</th>
                  <th className="text-left py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wide w-28">Categoría</th>
                  <th className="text-left py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wide">Acción</th>
                  <th className="text-left py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wide">Descripción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {registros.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-2.5 px-4 text-xs text-slate-400 whitespace-nowrap font-mono">
                      {fmtFechaHora(r.ts)}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex flex-col">
                        <span className="font-medium text-slate-800 text-xs">
                          {r.usuario?.nombre ?? r.usuario_nombre ?? '—'}
                        </span>
                        <span className="text-xs text-slate-400">
                          {r.usuario?.rol ?? r.usuario_rol ?? ''}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <CategoriaBadge categoria={r.categoria} />
                    </td>
                    <td className="py-2.5 px-4 text-xs font-mono text-slate-600 whitespace-nowrap">{r.accion}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 max-w-xs">
                      <span className="line-clamp-2">{r.descripcion ?? '—'}</span>
                      {r.entidad_tipo === 'cotizacion' && r.entidad_id && (
                        <span className="ml-1 font-mono text-slate-400 text-xs">
                          [{r.entidad_tipo}]
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {totalPags > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
              <span className="text-xs text-slate-400">
                Página {pagina + 1} de {totalPags}
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPagina(p => p - 1)} disabled={pagina === 0}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors">
                  <ChevronLeft size={14} />
                </button>
                <button onClick={() => setPagina(p => p + 1)} disabled={pagina >= totalPags - 1}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
