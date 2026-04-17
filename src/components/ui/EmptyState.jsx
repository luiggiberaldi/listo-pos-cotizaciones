import React from 'react';

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction
}) {
  return (
    <div className="flex flex-col items-center justify-center p-10 text-center rounded-2xl min-h-[300px] relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(27,54,93,0.03) 0%, rgba(184,134,11,0.03) 100%)',
        border: '1.5px dashed rgba(27,54,93,0.15)',
      }}>

      {/* Dot grid background */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, #1B365D 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }} />

      {/* Icon container */}
      <div className="relative mb-5">
        {/* Outer glow ring */}
        <div className="w-20 h-20 rounded-full absolute inset-0"
          style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.08), rgba(184,134,11,0.08))' }} />
        {/* Inner container */}
        <div className="relative w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(27,54,93,0.10) 0%, rgba(184,134,11,0.10) 100%)',
            border: '1.5px solid rgba(27,54,93,0.12)',
            boxShadow: 'inset 0 2px 4px rgba(27,54,93,0.06)',
          }}>
          {Icon
            ? <Icon size={32} style={{ color: '#1B365D', opacity: 0.5 }} />
            : <div className="w-8 h-8 rounded-full" style={{ background: 'rgba(27,54,93,0.2)' }} />
          }
        </div>
      </div>

      <h3 className="text-lg font-bold mb-1.5" style={{ color: '#1B365D' }}>
        {title}
      </h3>
      <p className="text-sm text-slate-500 max-w-xs mb-7 leading-relaxed">
        {description}
      </p>

      <div className="flex flex-col sm:flex-row gap-3 relative">
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="px-6 py-2.5 text-white font-semibold rounded-xl active:scale-95 transition-all shadow-lg"
            style={{
              background: 'linear-gradient(135deg, #1B365D, #B8860B)',
              boxShadow: '0 4px 12px rgba(27,54,93,0.25)',
            }}>
            {actionLabel}
          </button>
        )}

        {secondaryActionLabel && onSecondaryAction && (
          <button
            onClick={onSecondaryAction}
            className="px-6 py-2.5 bg-white hover:bg-slate-50 text-slate-600 font-semibold rounded-xl border border-slate-200 active:scale-95 transition-all">
            {secondaryActionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
