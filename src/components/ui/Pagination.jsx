// src/components/ui/Pagination.jsx
// Componente reutilizable de paginación
import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function Pagination({ paginaActual, totalPaginas, onCambiarPagina }) {
  if (totalPaginas <= 1) return null
  const [irAPagina, setIrAPagina] = useState('')

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowLeft' && paginaActual > 1) onCambiarPagina(paginaActual - 1)
      if (e.key === 'ArrowRight' && paginaActual < totalPaginas) onCambiarPagina(paginaActual + 1)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [paginaActual, totalPaginas, onCambiarPagina])

  function getPaginas() {
    const paginas = []
    const delta = 1
    let inicio = Math.max(2, paginaActual - delta)
    let fin = Math.min(totalPaginas - 1, paginaActual + delta)
    paginas.push(1)
    if (inicio > 2) paginas.push('...')
    for (let i = inicio; i <= fin; i++) paginas.push(i)
    if (fin < totalPaginas - 1) paginas.push('...')
    if (totalPaginas > 1) paginas.push(totalPaginas)
    return paginas
  }

  function handleIrAPagina(e) {
    e.preventDefault()
    const num = parseInt(irAPagina, 10)
    if (num >= 1 && num <= totalPaginas) {
      onCambiarPagina(num)
      setIrAPagina('')
    }
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
      <div className="flex items-center gap-1">
        {/* Anterior */}
        <button
          onClick={() => onCambiarPagina(paginaActual - 1)}
          disabled={paginaActual === 1}
          className="p-2.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={16} />
        </button>

        {/* Números */}
        {getPaginas().map((p, i) =>
          p === '...' ? (
            <span key={`dots-${i}`} className="px-1 text-slate-400 text-sm">...</span>
          ) : (
            <button
              key={p}
              onClick={() => onCambiarPagina(p)}
              className={`min-w-[36px] h-9 rounded-lg text-sm font-medium transition-colors ${
                p === paginaActual
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          )
        )}

        {/* Siguiente */}
        <button
          onClick={() => onCambiarPagina(paginaActual + 1)}
          disabled={paginaActual === totalPaginas}
          className="p-2.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Page info + go to page */}
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span>Página {paginaActual} de {totalPaginas}</span>
        {totalPaginas > 5 && (
          <form onSubmit={handleIrAPagina} className="flex items-center gap-1">
            <span>Ir a</span>
            <input
              type="number"
              min={1}
              max={totalPaginas}
              value={irAPagina}
              onChange={e => setIrAPagina(e.target.value)}
              className="w-12 px-2 py-1 text-xs text-center border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-focus"
              placeholder="#"
            />
          </form>
        )}
      </div>
    </div>
  )
}
