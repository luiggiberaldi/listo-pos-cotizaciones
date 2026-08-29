import React from 'react';

/**
 * LogoIcon — Isotipo de Construacero Carabobo
 * Ícono con gradiente sky → teal (extraído del logo oficial).
 * Úsalo en sidebar colapsado, favicons, y cabeceras compactas.
 */
export const LogoIcon = ({ className = 'w-10 h-10' }) => {
  return (
    <img
      src="/favicon.png"
      alt="Construacero Carabobo"
      className={`object-contain select-none ${className}`}
      draggable={false}
    />
  );
};

/**
 * LogoFull — Logo completo de Construacero Carabobo con imagen oficial.
 * Usar en sidebar expandido, pantallas de login y splash screens.
 */
export const LogoFull = ({ className = '', height = 56 }) => {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <img
        src="/logo.png"
        alt="Construacero Carabobo"
        style={{ height: `${height}px`, width: 'auto' }}
        className="object-contain select-none"
        draggable={false}
      />
    </div>
  );
};

/**
 * LogoWordmark — Texto "CONSTRUACERO" en tipografía de la marca.
 * Para cabeceras y pantallas donde no cabe la imagen completa.
 */
export const LogoWordmark = ({ className = '' }) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <LogoIcon className="w-8 h-8" />
      <div className="flex flex-col leading-none">
        <span className="text-base font-black tracking-tight text-[#334155]">
          CONSTRUACERO
        </span>
        <span className="text-[8px] font-bold uppercase tracking-[0.25em] text-[#B8860B]">
          Carabobo
        </span>
      </div>
    </div>
  );
};

export default LogoFull;
