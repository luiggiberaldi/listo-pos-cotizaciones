import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export const Modal = ({ isOpen, onClose, title, children, className = '' }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    // ✅ z-[100] asegura que esté por encima de la barra de navegación (z-30)
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      
      {/* Backdrop con desenfoque */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />
      
      {/* Contenido del Modal */}
      <div className={`relative bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl sm:rounded-[2rem] max-h-[100dvh] sm:max-h-[90vh] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200 transition-all ${className}`}>
        
        {/* Cabecera */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
          <h3 className="font-black text-slate-800 dark:text-white text-lg tracking-tight">{title}</h3>
          <button 
            onClick={onClose}
            className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full text-slate-500 hover:text-red-500 transition-colors"
          >
            <X size={16} strokeWidth={3} />
          </button>
        </div>

        {/* Body con Scroll Mejorado */}
        {/* ✅ CAMBIO: max-h-[85vh] para más espacio y pb-10 para margen inferior seguro */}
        <div className="p-4 sm:p-6 max-h-[calc(100dvh-60px)] sm:max-h-[85vh] overflow-y-auto custom-scrollbar pb-16">
          {children}
        </div>
      </div>
    </div>
  );
};
