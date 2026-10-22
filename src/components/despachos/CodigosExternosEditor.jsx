// src/components/despachos/CodigosExternosEditor.jsx
// Editor ligero de códigos para productos externos, visible en el modal de
// aprobación del despacho. Solo edita el TEXTO del código (codigo_snap):
// no toca inventario, precios, pagos ni totales.
import { Tag, Info } from 'lucide-react'

// Un ítem es externo cuando no está ligado al catálogo (producto_id vacío).
// Aunque se agregó "como externo" desde el catálogo, en la base queda sin
// producto_id, así que esta regla lo cubre.
export function esItemExterno(it) {
  return it?.origen === 'externo'
    || !it?.producto_id
    || String(it?.producto_id || '').startsWith('manual-')
}

// Código automático = el que el sistema inventa al agregar el artículo externo
// (EXT + números, ej. EXT4839201). Un código ya corregido a mano no entra aquí.
export function esCodigoAutomatico(codigo) {
  return /^EXT\d{5,}$/i.test(String(codigo || '').trim())
}

export default function CodigosExternosEditor({ items = [], codigos = {}, onChange }) {
  if (items.length === 0) return null

  return (
    <div className="w-full text-left bg-indigo-50 p-3 rounded-xl text-sm border border-indigo-200 mt-2 shadow-sm">
      <h4 className="font-bold text-indigo-700 border-b border-indigo-200 pb-1.5 mb-2 flex items-center gap-1.5">
        <Tag size={13} /> Códigos de productos externos
      </h4>
      <p className="text-[11px] text-indigo-600 leading-snug mb-2.5 flex items-start gap-1.5">
        <Info size={12} className="mt-0.5 shrink-0" />
        <span>
          Estos artículos se vendieron fuera del catálogo y traen un código automático.
          Escríbeles el código real antes de aprobar (opcional).
        </span>
      </p>
      <div className="space-y-1.5">
        {items.map(it => (
          <div key={it.id} className="flex items-center gap-2">
            <span className="text-xs text-slate-600 truncate max-w-[45%]">{it.nombre_snap}</span>
            <input
              type="text"
              value={codigos[it.id] ?? it.codigo_snap ?? ''}
              onChange={e => onChange(it.id, e.target.value.toUpperCase())}
              maxLength={40}
              placeholder="CÓDIGO"
              className="flex-1 min-w-[110px] px-2 py-1.5 text-xs font-mono border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:outline-none bg-white"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
