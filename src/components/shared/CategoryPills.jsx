// src/components/shared/CategoryPills.jsx
// Pills de categoría reutilizables — colapsables en móvil, scroll en desktop
import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'

const VISIBLE_MOBILE = 4 // pills visibles antes de colapsar

export default function CategoryPills({ categorias = [], activa = '', onChange }) {
  const [expanded, setExpanded] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const scrollRef = useRef(null)

  function checkScroll() {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', checkScroll, { passive: true })
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect() }
  }, [categorias])

  function scrollBy(dir) {
    scrollRef.current?.scrollBy({ left: dir * 200, behavior: 'smooth' })
  }

  function handleSelect(cat) {
    onChange(cat === activa ? '' : cat)
  }

  if (!categorias.length) return null

  const categoriasUnicas = categorias.filter(
    (cat, idx, arr) => arr.findIndex(x => x.value === cat.value) === idx
  )

  const extraCount = categoriasUnicas.length - VISIBLE_MOBILE

  return (
    <>
      {/* ── Desktop: scroll horizontal con flechas (sin cambio) ── */}
      <div className="hidden md:flex relative items-center gap-1">
        <button type="button" onClick={() => scrollBy(-1)}
          className={`shrink-0 p-1 rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-all ${canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <ChevronLeft size={14} />
        </button>
        <div ref={scrollRef} className="flex-1 overflow-x-auto scrollbar-hide">
          <div className="flex gap-1.5 py-0.5 w-max">
            <Pill label="Todos" active={!activa} onClick={() => handleSelect('')} />
            {categoriasUnicas.map(cat => (
              <Pill key={cat.value} label={cat.label} active={activa === cat.value} onClick={() => handleSelect(cat.value)} />
            ))}
          </div>
        </div>
        <button type="button" onClick={() => scrollBy(1)}
          className={`shrink-0 p-1 rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-all ${canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* ── Mobile: scroll horizontal + expandible ── */}
      <div className="md:hidden relative">
        <div className={`flex gap-1.5 py-0.5 ${expanded ? 'flex-wrap' : 'flex-nowrap overflow-x-auto scrollbar-hide'}`}>
          <Pill label="Todos" active={!activa} onClick={() => handleSelect('')} />
          {(expanded ? categoriasUnicas : categoriasUnicas.slice(0, VISIBLE_MOBILE)).map(cat => (
            <Pill key={cat.value} label={cat.label} active={activa === cat.value} onClick={() => handleSelect(cat.value)} />
          ))}
          {/* Botón expandir/colapsar */}
          {extraCount > 0 && (
            <button type="button" onClick={() => setExpanded(!expanded)}
              className="shrink-0 px-2.5 py-1.5 rounded-full text-xs font-bold bg-slate-200 text-slate-600 hover:bg-slate-300 transition-all flex items-center gap-0.5 whitespace-nowrap">
              {expanded ? (
                <><ChevronUp size={12} /> Menos</>
              ) : (
                <><ChevronDown size={12} /> +{extraCount}</>
              )}
            </button>
          )}
        </div>
        {!expanded && (
          <div className="absolute right-0 top-0 bottom-0 w-6 pointer-events-none bg-gradient-to-l from-white to-transparent" />
        )}
      </div>
    </>
  )
}

function Pill({ label, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
        active ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
      }`}>
      {label}
    </button>
  )
}
