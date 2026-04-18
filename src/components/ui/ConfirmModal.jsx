import React, { useState } from 'react';
import { AlertTriangle, Trash2, ShoppingCart, X, Loader2, CheckCircle } from 'lucide-react';
import { showToast } from './Toast';

const VARIANTS = {
  danger: {
    icon: Trash2,
    iconColor: '#ef4444',
    stripStart: '#fca5a5',
    stripEnd: '#ef4444',
    btnStyle: { background: 'linear-gradient(135deg, #dc2626, #b91c1c)', boxShadow: '0 4px 12px rgba(220,38,38,0.3)' },
  },
  warning: {
    icon: AlertTriangle,
    iconColor: '#f59e0b',
    stripStart: '#fde68a',
    stripEnd: '#f59e0b',
    btnStyle: { background: 'linear-gradient(135deg, #d97706, #b45309)', boxShadow: '0 4px 12px rgba(217,119,6,0.3)' },
  },
  cart: {
    icon: ShoppingCart,
    iconColor: '#475569',
    stripStart: '#cbd5e1',
    stripEnd: '#475569',
    btnStyle: { background: 'linear-gradient(135deg, #334155, #1e293b)', boxShadow: '0 4px 12px rgba(51,65,85,0.3)' },
  },
  success: {
    icon: CheckCircle,
    iconColor: '#059669',
    stripStart: '#6ee7b7',
    stripEnd: '#059669',
    btnStyle: { background: 'linear-gradient(135deg, #065f46, #047857)', boxShadow: '0 4px 12px rgba(5,150,105,0.3)' },
  },
  default: {
    icon: CheckCircle,
    iconColor: '#1B365D',
    stripStart: '#93c5fd',
    stripEnd: '#1B365D',
    btnStyle: { background: 'linear-gradient(135deg, #1B365D, #B8860B)', boxShadow: '0 4px 12px rgba(27,54,93,0.3)' },
  },
};

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = '¿Estás seguro?',
  message = '',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  variant = 'danger',
}) {
  const [loading, setLoading] = useState(false);
  if (!isOpen) return null;

  const v = VARIANTS[variant] || VARIANTS.danger;
  const IconComp = v.icon;

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      console.error('ConfirmModal error:', err);
      showToast(err.message || 'Ocurrió un error inesperado', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}>
      <div
        className="relative bg-white rounded-[1.5rem] max-w-sm w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}>

        {/* Color strip top */}
        <div className="relative h-24 flex items-center justify-center shrink-0"
          style={{ background: `linear-gradient(135deg, ${v.stripStart} 0%, ${v.stripEnd} 100%)` }}>

          {/* Dot grid */}
          <div className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
              backgroundSize: '12px 12px',
            }} />

          {/* Icon glassmorphism circle */}
          <div className="relative w-14 h-14 rounded-full flex items-center justify-center"
            style={{
              background: 'rgba(255,255,255,0.25)',
              border: '1.5px solid rgba(255,255,255,0.5)',
              backdropFilter: 'blur(4px)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            }}>
            <IconComp size={26} color="white" />
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            disabled={loading}
            className="absolute top-3 right-3 p-1.5 rounded-full transition-colors disabled:opacity-50"
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.35)',
              color: 'white',
            }}>
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pt-5 pb-6">
          <h3 className="text-lg font-black text-slate-800 text-center mb-2">{title}</h3>

          {message && (
            <p className="text-sm text-slate-500 text-center leading-relaxed mb-6 whitespace-pre-line">{message}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors border border-slate-100 disabled:opacity-50">
              {cancelText}
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 py-3 text-sm font-bold text-white rounded-xl active:scale-95 transition-all disabled:opacity-70 flex items-center justify-center gap-2"
              style={v.btnStyle}>
              {loading && <Loader2 size={14} className="animate-spin" />}
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
