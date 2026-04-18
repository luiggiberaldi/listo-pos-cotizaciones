import React, { useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';

export const Modal = ({ isOpen, onClose, title, children, className = '' }) => {
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    // Trap focus inside modal
    if (e.key === 'Tab' && modalRef.current) {
      const focusable = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    // Save previous focus to restore later
    previousFocusRef.current = document.activeElement;
    document.addEventListener('keydown', handleKeyDown);
    // Focus first focusable element in modal
    requestAnimationFrame(() => {
      if (modalRef.current) {
        const firstFocusable = modalRef.current.querySelector(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        firstFocusable?.focus();
      }
    });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus on close
      previousFocusRef.current?.focus();
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    // z-[100] asegura que esté por encima de la barra de navegación (z-30)
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >

      {/* Backdrop con desenfoque */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Contenido del Modal */}
      <div
        ref={modalRef}
        className={`relative bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl sm:rounded-[2rem] max-h-[100dvh] sm:max-h-[90vh] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200 transition-all pb-[env(safe-area-inset-bottom)] ${className}`}
      >

        {/* Cabecera */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
          <h3 className="font-black text-slate-800 dark:text-white text-lg tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full text-slate-500 hover:text-red-500 transition-colors"
            aria-label="Cerrar"
          >
            <X size={16} strokeWidth={3} />
          </button>
        </div>

        {/* Body con Scroll Mejorado */}
        <div className="p-4 sm:p-6 max-h-[calc(100dvh-60px)] sm:max-h-[85vh] overflow-y-auto custom-scrollbar pb-16">
          {children}
        </div>
      </div>
    </div>
  );
};
