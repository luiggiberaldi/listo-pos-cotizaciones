// src/components/ui/Pagination.jsx
// Componente reutilizable de paginación
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function Pagination({ paginaActual, totalPaginas, onCambiarPagina }) {
  if (totalPaginas <= 1) return null

  // Genera los números de página visibles
  function getPaginas() {
    const paginas = []
    const delta = 1 // cuántas páginas mostrar a cada lado de la actual

    let inicio = Math.max(2, paginaActual - delta)
    let fin = Math.min(totalPaginas - 1, paginaActual + delta)

    // Siempre incluir la primera
    paginas.push(1)

    if (inicio > 2) paginas.push('...')
    for (let i = inicio; i <= fin; i++) paginas.push(i)
    if (fin < totalPaginas - 1) paginas.push('...')

    // Siempre incluir la última
    if (totalPaginas > 1) paginas.push(totalPaginas)

    return paginas
  }

  return (
    <div className="flex items-center justify-center gap-1 pt-2">
      {/* Anterior */}
      <button
        onClick={() => onCambiarPagina(paginaActual - 1)}
        disabled={paginaActual === 1}
        className="p-3 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={18} />
      </button>

      {/* Números */}
      {getPaginas().map((p, i) =>
        p === '...' ? (
          <span key={`dots-${i}`} className="px-1 text-slate-400 text-base">...</span>
        ) : (
          <button
            key={p}
            onClick={() => onCambiarPagina(p)}
            className={`min-w-[40px] h-10 rounded-lg text-base font-medium transition-colors ${
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
        className="p-3 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  )
}
