// src/components/ui/PendingQueueBadge.jsx
// Badge que muestra el número de ventas pendientes de sincronización.
// Se monta en el AppLayout junto al ítem de "Venta Rápida" del menú.
// Cuando hay fallidas, cambia a rojo con ícono de advertencia y permite
// abrir un panel de gestión.
import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, RefreshCw, Trash2, X, CloudOff } from 'lucide-react'
import { useMutationQueue } from '../../hooks/useMutationQueue'

export default function PendingQueueBadge() {
  const { pending, failed, syncing, retry, discard, sync, refresh } = useMutationQueue()
  const [open, setOpen] = useState(false)

  // Escuchar mensaje del SW cuando sincroniza en background
  useEffect(() => {
    function handleSWMessage(e) {
      if (e.data?.type === 'MUTATION_QUEUE_SYNCED') {
        refresh()
      }
    }
    navigator.serviceWorker?.addEventListener('message', handleSWMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', handleSWMessage)
  }, [refresh])

  const total = pending + failed.length
  if (total === 0) return null

  return (
    <>
      {/* Badge compacto */}
      <button
        onClick={() => setOpen(true)}
        title={`${pending} venta${pending !== 1 ? 's' : ''} pendiente${pending !== 1 ? 's' : ''} de sincronizar`}
        className={`relative flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold transition-all ${
          failed.length > 0
            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse'
            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
        }`}
      >
        {failed.length > 0 ? <AlertTriangle size={12} /> : <CloudOff size={12} />}
        <span>{total}</span>
      </button>

      {/* Panel de detalle */}
      {open && (
        <div className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <CloudOff size={16} className="text-amber-400" />
                <span className="text-sm font-semibold text-white">Cola de ventas offline</span>
              </div>
              <div className="flex items-center gap-2">
                {pending > 0 && (
                  <button
                    onClick={() => sync()}
                    disabled={syncing}
                    className="flex items-center gap-1 px-2.5 py-1 bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 text-xs font-medium rounded-lg transition-all disabled:opacity-50"
                  >
                    <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
                    {syncing ? 'Sincronizando...' : 'Reintentar ahora'}
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Pendientes */}
            {pending > 0 && (
              <div className="px-4 py-3 border-b border-slate-800">
                <p className="text-xs text-amber-300 font-medium mb-1">
                  {pending} venta{pending !== 1 ? 's' : ''} esperando conexión
                </p>
                <p className="text-xs text-slate-400">
                  Se enviarán automáticamente al reconectar. El stock se descontará al sincronizar.
                </p>
              </div>
            )}

            {/* Fallidas */}
            {failed.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-xs text-rose-300 font-medium mb-2">
                  {failed.length} venta{failed.length !== 1 ? 's' : ''} con error
                </p>
                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                  {failed.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-2 bg-rose-950/30 border border-rose-800/30 rounded-lg p-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white font-medium truncate">Venta Rápida</p>
                        <p className="text-xs text-rose-300 truncate">{item.error || 'Error desconocido'}</p>
                        <p className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString('es-VE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => retry(item.id)}
                          title="Reintentar"
                          className="p-1.5 bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 rounded-lg transition-all"
                        >
                          <RefreshCw size={12} />
                        </button>
                        <button
                          onClick={() => discard(item.id)}
                          title="Descartar"
                          className="p-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 rounded-lg transition-all"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </>
  )
}
