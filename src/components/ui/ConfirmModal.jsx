import React, { useState } from 'react';
import { AlertTriangle, Trash2, ShoppingCart, X, Loader2 } from 'lucide-react';

const ICONS = {
    danger: <Trash2 size={28} className="text-red-500" />,
    warning: <AlertTriangle size={28} className="text-amber-500" />,
    cart: <ShoppingCart size={28} className="text-slate-500" />,
};

const COLORS = {
    danger: {
        iconBg: 'bg-red-50',
        btn: 'bg-red-500 hover:bg-red-600 shadow-red-500/20',
    },
    warning: {
        iconBg: 'bg-amber-50',
        btn: 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20',
    },
    cart: {
        iconBg: 'bg-slate-100',
        btn: 'bg-slate-700 hover:bg-slate-800 shadow-slate-700/20',
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

    const colors = COLORS[variant] || COLORS.danger;
    const icon = ICONS[variant] || ICONS.danger;

    async function handleConfirm() {
        setLoading(true);
        try {
            await onConfirm();
            onClose();
        } catch (err) {
            console.error('ConfirmModal error:', err);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="relative bg-white rounded-[1.5rem] p-6 max-w-sm w-full shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}>

                {/* Close button */}
                <button onClick={onClose} disabled={loading}
                    className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors disabled:opacity-50">
                    <X size={16} />
                </button>

                {/* Icon */}
                <div className={`w-14 h-14 ${colors.iconBg} rounded-2xl flex items-center justify-center mx-auto mb-4`}>
                    {icon}
                </div>

                {/* Title */}
                <h3 className="text-lg font-black text-slate-800 text-center mb-2">{title}</h3>

                {/* Message */}
                {message && (
                    <p className="text-sm text-slate-500 text-center leading-relaxed mb-6 whitespace-pre-line">{message}</p>
                )}

                {/* Actions */}
                <div className="flex gap-3 w-full">
                    <button onClick={onClose} disabled={loading}
                        className="flex-1 py-3.5 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50">
                        {cancelText}
                    </button>
                    <button onClick={handleConfirm} disabled={loading}
                        className={`flex-1 py-3.5 text-sm font-bold text-white ${colors.btn} rounded-xl shadow-lg active:scale-95 transition-all disabled:opacity-70 flex items-center justify-center gap-2`}>
                        {loading && <Loader2 size={14} className="animate-spin" />}
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
