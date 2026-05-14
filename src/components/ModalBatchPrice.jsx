import React, { useState, useEffect } from 'react'
import { Modal } from './ui/Modal'
import CustomSelect from './ui/CustomSelect'
import { showToast } from './ui/Toast'
import { authFetch } from '../services/authFetch'
import { Calculator, Eye, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

export default function ModalBatchPrice({ isOpen, onClose, cuentaId, categorias = [], onSuccess }) {
  const [modo, setModo] = useState('porcentaje')
  const [porcentaje, setPorcentaje] = useState('')
  const [valorFijo, setValorFijo] = useState('')
  const [categoria, setCategoria] = useState('')
  const [precioObjetivo, setPrecioObjetivo] = useState('precio_usd')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)

  // Resetear estado al cerrar
  useEffect(() => {
    if (!isOpen) {
      setModo('porcentaje')
      setPorcentaje('')
      setValorFijo('')
      setCategoria('')
      setPrecioObjetivo('precio_usd')
      setPreview(null)
      setLoading(false)
    }
  }, [isOpen])

  // Resetear preview al cambiar cualquier input
  useEffect(() => {
    setPreview(null)
  }, [modo, porcentaje, valorFijo, categoria, precioObjetivo])

  if (!isOpen) return null

  const handlePreview = async () => {
    const valor = modo === 'porcentaje' ? porcentaje : valorFijo
    if (!valor) {
      showToast('Ingresa un valor para continuar', 'warning')
      return
    }

    setLoading(true)
    try {
      const res = await authFetch('/api/productos/batch-price', {
        method: 'PATCH',
        body: JSON.stringify({
          cuenta_id: cuentaId,
          modo,
          porcentaje: modo === 'porcentaje' ? Number(porcentaje) : 0,
          valor_fijo: modo === 'valor_fijo' ? Number(valorFijo) : 0,
          categoria: categoria || null,
          precio_objetivo: precioObjetivo,
          preview_only: true
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al obtener vista previa')
      }

      const data = await res.json()
      setPreview(data)
    } catch (error) {
      showToast(error.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    if (!preview) return
    setLoading(true)
    try {
      const res = await authFetch('/api/productos/batch-price', {
        method: 'PATCH',
        body: JSON.stringify({
          cuenta_id: cuentaId,
          modo,
          porcentaje: modo === 'porcentaje' ? Number(porcentaje) : 0,
          valor_fijo: modo === 'valor_fijo' ? Number(valorFijo) : 0,
          categoria: categoria || null,
          precio_objetivo: precioObjetivo,
          preview_only: false
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al actualizar precios')
      }

      const data = await res.json()
      showToast(`${data.updated} productos actualizados con éxito`, 'success')
      if (onSuccess) onSuccess()
      onClose()
    } catch (error) {
      showToast(error.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const catOptions = [
    { value: '', label: '— Todas las categorías —' },
    ...categorias.map(c => ({ value: c, label: c }))
  ]

  const modoOptions = [
    { value: 'porcentaje', label: 'Porcentaje (%)' },
    { value: 'valor_fijo', label: 'Valor fijo (USD)' }
  ]

  const objetivoOptions = [
    { value: 'precio_usd', label: 'Precio 1 (Detal)' },
    { value: 'precio_2', label: 'Precio 2' },
    { value: 'precio_3', label: 'Precio 3' },
    { value: 'todos', label: 'Todos los precios' }
  ]

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Actualización Masiva" className="max-w-md">
      <div className="space-y-5">
        
        <div className="space-y-4">
          {/* Modo de ajuste */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">Modo de ajuste</label>
            <CustomSelect
              options={modoOptions}
              value={modo}
              onChange={setModo}
              placeholder="Seleccionar modo"
            />
          </div>

          {/* Valor */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">
              {modo === 'porcentaje' ? 'Porcentaje (%)' : 'Precio fijo (USD)'}
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                value={modo === 'porcentaje' ? porcentaje : valorFijo}
                onChange={e => modo === 'porcentaje' ? setPorcentaje(e.target.value) : setValorFijo(e.target.value)}
                placeholder={modo === 'porcentaje' ? "Ej: 10 o -5" : "Ej: 25.50"}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                {modo === 'porcentaje' ? '%' : '$'}
              </div>
            </div>
          </div>

          {/* Precio objetivo */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">Precio a modificar</label>
            <CustomSelect
              options={objetivoOptions}
              value={precioObjetivo}
              onChange={setPrecioObjetivo}
            />
          </div>

          {/* Categoría */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">Filtrar por categoría</label>
            <CustomSelect
              options={catOptions}
              value={categoria}
              onChange={setCategoria}
              searchable={true}
            />
          </div>
        </div>

        {/* Botón Preview */}
        <button
          onClick={handlePreview}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Eye size={18} />
          )}
          Vista previa
        </button>

        {/* Sección de Preview */}
        {preview && (
          <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <CheckCircle2 size={16} />
              Se actualizarán {preview.count} productos
            </div>
            
            <div className="space-y-2">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ejemplos:</div>
              {preview.ejemplos.map((ej, i) => {
                const f = precioObjetivo === 'todos' ? 'precio_usd' : precioObjetivo;
                const actual = Number(ej[f]?.actual || 0).toFixed(2);
                const nuevo = Number(ej[f]?.nuevo || 0).toFixed(2);
                return (
                  <div key={i} className="flex flex-col text-xs">
                    <span className="text-slate-600 font-medium truncate">{ej.nombre}</span>
                    <div className="flex items-center gap-2 font-mono font-bold">
                      <span className="text-slate-400">${actual}</span>
                      <span className="text-primary">→</span>
                      <span className="text-primary-focus">${nuevo}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Botón Confirmar */}
        <button
          onClick={handleConfirm}
          disabled={!preview || loading}
          className="w-full flex items-center justify-center gap-2 py-3.5 text-white font-black rounded-2xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-30 disabled:grayscale"
          style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
        >
          Confirmar actualización
        </button>

        {/* Espaciador para evitar que los dropdowns se corten al final del modal */}
        <div className="h-20" />

      </div>
    </Modal>
  )
}
