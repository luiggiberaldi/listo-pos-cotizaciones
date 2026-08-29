import { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import CustomSelect from '../ui/CustomSelect'
import { showToast } from '../ui/Toast'
import { authFetch } from '../../services/authFetch'
import { ArrowDown, ArrowLeftRight } from 'lucide-react'

export default function ModalTransformacion({ isOpen, onClose, productos = [], cuentaId, onSuccess }) {
  const [origenId, setOrigenId] = useState('')
  const [origenCantidad, setOrigenCantidad] = useState('')
  const [destinoId, setDestinoId] = useState('')
  const [destinoCantidad, setDestinoCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const [loading, setLoading] = useState(false)

  // Resetear estados al cerrar
  useEffect(() => {
    if (!isOpen) {
      setOrigenId('')
      setOrigenCantidad('')
      setDestinoId('')
      setDestinoCantidad('')
      setMotivo('')
      setLoading(false)
    }
  }, [isOpen])

  const handleClose = () => {
    if (loading) return
    onClose()
  }

  const handleSubmit = async () => {
    // Validaciones
    if (!origenId || !destinoId) {
      showToast('Selecciona ambos productos', 'warning')
      return
    }
    if (origenId === destinoId) {
      showToast('Origen y destino no pueden ser el mismo', 'warning')
      return
    }
    if (!origenCantidad || Number(origenCantidad) <= 0) {
      showToast('Ingresa una cantidad de origen válida', 'warning')
      return
    }
    if (!destinoCantidad || Number(destinoCantidad) <= 0) {
      showToast('Ingresa una cantidad de destino válida', 'warning')
      return
    }
    if (!motivo.trim()) {
      showToast('El motivo es obligatorio', 'warning')
      return
    }

    const prodOri = productos.find(p => p.id === origenId)
    if (Number(origenCantidad) > Number(prodOri?.stock_actual || 0)) {
      showToast(`Stock insuficiente. Disponible: ${prodOri?.stock_actual || 0}`, 'error')
      return
    }

    setLoading(true)
    try {
      const res = await authFetch('/api/inventario/transformacion', {
        method: 'POST',
        body: JSON.stringify({
          origen: { producto_id: origenId, cantidad: Number(origenCantidad) },
          destino: { producto_id: destinoId, cantidad: Number(destinoCantidad) },
          motivo: motivo.trim()
        })
      })

      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Error al aplicar transformación', 'error')
        return
      }

      showToast(`Transformación aplicada. ${data.origen.nombre} → ${data.destino.nombre}`, 'success')
      if (onSuccess) onSuccess()
      onClose()
    } catch (error) {
      showToast(error.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Transformar Producto" className="max-w-md">
      <p className="text-xs text-slate-400 -mt-2 mb-4">
        Convierte stock de un producto en otro. Ej: cabilla 12 → cabilla 6
      </p>

      <div className="space-y-4">
        {/* ORIGEN */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">
            Producto a consumir (origen)
          </label>
          <CustomSelect
            options={productos.filter(p => p.activo).map(p => ({
              value: p.id,
              label: `${p.nombre} — Stock: ${p.stock_actual} ${p.unidad ?? 'und'}`
            }))}
            value={origenId}
            onChange={val => { setOrigenId(val); setOrigenCantidad('') }}
            placeholder="Seleccionar producto origen"
            searchable={true}
          />
          <div className="relative">
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Cantidad a consumir"
              value={origenCantidad}
              onChange={e => setOrigenCantidad(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            {origenId && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
                {productos.find(x => x.id === origenId)?.unidad ?? 'und'}
              </div>
            )}
          </div>
          {origenId && (
            <span className="text-[11px] text-slate-500 ml-1">
              Disponible: <strong>{productos.find(x => x.id === origenId)?.stock_actual} {productos.find(x => x.id === origenId)?.unidad ?? 'und'}</strong>
            </span>
          )}
        </div>

        {/* Flecha */}
        <div className="flex justify-center text-slate-300">
          <ArrowDown size={22} />
        </div>

        {/* DESTINO */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">
            Producto que se genera (destino)
          </label>
          <CustomSelect
            options={productos.filter(p => p.activo && p.id !== origenId).map(p => ({
              value: p.id,
              label: `${p.nombre} — Stock: ${p.stock_actual} ${p.unidad ?? 'und'}`
            }))}
            value={destinoId}
            onChange={setDestinoId}
            placeholder="Seleccionar producto destino"
            searchable={true}
          />
          <div className="relative">
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Cantidad resultante"
              value={destinoCantidad}
              onChange={e => setDestinoCantidad(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            {destinoId && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
                {productos.find(x => x.id === destinoId)?.unidad ?? 'und'}
              </div>
            )}
          </div>
          {destinoId && (
            <span className="text-[11px] text-slate-500 ml-1">
              Stock actual: <strong>{productos.find(x => x.id === destinoId)?.stock_actual} {productos.find(x => x.id === destinoId)?.unidad ?? 'und'}</strong>
            </span>
          )}
        </div>

        {/* Motivo */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">
            Descripción / Motivo
          </label>
          <input
            type="text"
            placeholder='Ej: Corte cabilla 3/8 × 6m → cabilla 3/8 × 3m'
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
        </div>

        {/* Botón confirmar */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3.5 text-white font-black rounded-2xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <ArrowLeftRight size={18} />
          )}
          Confirmar transformación
        </button>
      </div>
    </Modal>
  )
}
