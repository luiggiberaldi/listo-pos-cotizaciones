// src/utils/motivosTipo.js
// Constantes compartidas para categorías de motivo de movimientos de inventario

import { ShoppingCart, ClipboardCheck, AlertTriangle, Undo2, ArrowLeftRight, MoreHorizontal } from 'lucide-react'

export const MOTIVOS_TIPO = {
  compra_proveedor:  { label: 'Compra proveedor',  color: 'blue',   icon: ShoppingCart },
  ajuste_inventario: { label: 'Ajuste inventario',  color: 'purple', icon: ClipboardCheck },
  merma:             { label: 'Merma / pérdida',    color: 'amber',  icon: AlertTriangle },
  devolucion:        { label: 'Devolución',         color: 'orange', icon: Undo2 },
  transferencia:     { label: 'Transferencia',      color: 'cyan',   icon: ArrowLeftRight },
  otro:              { label: 'Otro',               color: 'slate',  icon: MoreHorizontal },
}

export const MOTIVOS_TIPO_LIST = Object.entries(MOTIVOS_TIPO).map(([value, cfg]) => ({
  value,
  ...cfg,
}))

export function formatCorrelativo(numero) {
  if (!numero && numero !== 0) return '—'
  return `MOV-${String(numero).padStart(5, '0')}`
}

// Colores Tailwind para los chips de motivo
export const MOTIVO_COLORS = {
  blue:   { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
  amber:  { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-500' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  cyan:   { bg: 'bg-cyan-50',   text: 'text-cyan-700',   border: 'border-cyan-200',   dot: 'bg-cyan-500' },
  slate:  { bg: 'bg-slate-50',  text: 'text-slate-600',  border: 'border-slate-200',  dot: 'bg-slate-400' },
}

export function getMotivoChipClasses(motivoTipo) {
  const cfg = MOTIVOS_TIPO[motivoTipo] || MOTIVOS_TIPO.otro
  return MOTIVO_COLORS[cfg.color] || MOTIVO_COLORS.slate
}
