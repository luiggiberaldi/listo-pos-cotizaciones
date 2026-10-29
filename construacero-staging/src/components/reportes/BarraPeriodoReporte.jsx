// src/components/reportes/BarraPeriodoReporte.jsx
// Barra común de las pestañas de Reportes: tarjeta con el período (título +
// etiqueta del rango + selector de fechas) y, debajo a la derecha, los botones
// "Imprimir PDF ▾" y "Descargar PDF ▾" con las variantes del reporte.
// Misma apariencia que Comisiones / Ventas, para que todas se usen igual.
//
// Props:
//   titulo        texto del rótulo ("Periodo de despachos")
//   rango         { from, to } en YYYY-MM-DD (o null = todo el historial)
//   onCambiarRango(rango)
//   opciones      [{ id, label, icon? , ayuda? }] variantes del PDF
//   onExportar(opcionId, 'imprimir' | 'descargar')
//   exportando    muestra "Generando..." y bloquea los botones
//   deshabilitado bloquea los botones (p. ej. sin datos)
//   acciones      nodos extra a la izquierda de los botones (p. ej. recargar)
//   filtros       filtros propios de la pestaña (vendedor, formato, búsqueda...)
//                 que van debajo de las fechas
// Con una sola opción, los botones exportan directo (sin menú).
import { useState } from 'react'
import { Printer, Download, ChevronDown, FileText } from 'lucide-react'
import DateRangeSelector from './DateRangeSelector'

function fechaLarga(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function etiquetaRango(rango) {
  if (!rango?.from || !rango?.to) return 'Todo el historial'
  return `${fechaLarga(rango.from)} - ${fechaLarga(rango.to)}`
}

function MenuExportar({ tipo, abierto, onAbrir, onCerrar, opciones, onElegir, exportando, deshabilitado }) {
  const esImprimir = tipo === 'imprimir'
  const Icono = esImprimir ? Printer : Download
  const texto = esImprimir ? 'Imprimir PDF' : 'Descargar PDF'
  const directo = opciones.length === 1
  return (
    <div className="relative flex-1 sm:flex-none">
      <button
        onClick={directo ? () => onElegir(opciones[0].id, tipo) : onAbrir}
        disabled={exportando || deshabilitado}
        aria-haspopup="menu"
        aria-expanded={abierto}
        className={esImprimir
          ? 'w-full sm:w-auto justify-center flex items-center gap-2 text-xs font-black px-4 sm:px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm'
          : 'w-full sm:w-auto justify-center flex items-center gap-2 text-xs font-black px-4 sm:px-5 py-2.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-indigo-100/40'}
        style={esImprimir ? undefined : { background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
      >
        <Icono size={13} className={esImprimir ? 'text-slate-500' : undefined} />
        <span>{exportando ? 'Generando...' : texto}</span>
        {!directo && <ChevronDown size={13} className={`transition-transform duration-200 ${abierto ? 'rotate-180' : ''}`} />}
      </button>
      {abierto && !directo && (
        <>
          <div className="fixed inset-0 z-10" onClick={onCerrar} />
          <div role="menu" className={`absolute ${esImprimir ? 'left-0 sm:left-auto sm:right-0' : 'right-0'} mt-2 w-64 rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150`}>
            {opciones.map((op, i) => {
              const IconoOp = op.icon || FileText
              return (
                <button
                  key={op.id}
                  role="menuitem"
                  onClick={() => { onCerrar(); onElegir(op.id, tipo) }}
                  className={`w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-start gap-2.5 transition-colors ${i > 0 ? 'border-t border-slate-50' : ''}`}
                >
                  <IconoOp size={14} className="text-slate-400 shrink-0 mt-0.5" />
                  <span>
                    {esImprimir ? 'Imprimir' : 'Descargar'} {op.label}
                    {op.ayuda && <span className="block text-[10px] font-medium text-slate-400 mt-0.5">{op.ayuda}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default function BarraPeriodoReporte({
  titulo = 'Periodo',
  rango,
  onCambiarRango,
  opciones = [],
  onExportar,
  exportando = false,
  deshabilitado = false,
  acciones = null,
  filtros = null,
}) {
  const [menu, setMenu] = useState(null) // null | 'imprimir' | 'descargar'
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex flex-col gap-6">
        <div className="w-full">
          <div className="flex items-center gap-2 ml-1 mb-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{titulo}</label>
            <span className="hidden sm:inline-flex text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
              {etiquetaRango(rango)}
            </span>
          </div>
          <DateRangeSelector value={rango} onChange={onCambiarRango} />
        </div>

        {filtros && <div className="w-full -mt-2">{filtros}</div>}

        {opciones.length > 0 && (
          <div className="flex flex-wrap justify-end items-center gap-2 sm:gap-3 border-t border-slate-50 pt-4 relative">
            {acciones}
            <MenuExportar
              tipo="imprimir"
              abierto={menu === 'imprimir'}
              onAbrir={() => setMenu(m => (m === 'imprimir' ? null : 'imprimir'))}
              onCerrar={() => setMenu(null)}
              opciones={opciones}
              onElegir={onExportar}
              exportando={exportando}
              deshabilitado={deshabilitado}
            />
            <MenuExportar
              tipo="descargar"
              abierto={menu === 'descargar'}
              onAbrir={() => setMenu(m => (m === 'descargar' ? null : 'descargar'))}
              onCerrar={() => setMenu(null)}
              opciones={opciones}
              onElegir={onExportar}
              exportando={exportando}
              deshabilitado={deshabilitado}
            />
          </div>
        )}
      </div>
    </div>
  )
}
