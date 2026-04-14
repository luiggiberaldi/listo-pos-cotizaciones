import React from 'react';

/**
 * LogoIcon — Isotipo de Listo POS Lite
 * Ícono de encendido con gradiente sky → teal (extraído del logo oficial).
 * Úsalo en sidebar colapsado, favicons, y cabeceras compactas.
 */
/**
 * LogoIcon — Isotipo oficial de Listo POS Lite
 * Usa la imagen favicon.png (ícono de encendido sky→teal).
 * Úsalo en sidebar colapsado y cabeceras compactas.
 */
export const LogoIcon = ({ className = 'w-10 h-10' }) => {
  return (
    <img
      src="/favicon.png"
      alt="Listo POS Lite"
      className={`object-contain select-none ${className}`}
      draggable={false}
    />
  );
};

/**
 * LogoFull — Logo completo de Listo POS Lite con imagen oficial.
 * Usar en sidebar expandido, pantallas de login y splash screens.
 */
export const LogoFull = ({ className = '', height = 56 }) => {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <img
        src="/logo.png"
        alt="Listo POS Lite"
        style={{ height: `${height}px`, width: 'auto' }}
        className="object-contain select-none"
        draggable={false}
      />
    </div>
  );
};

/**
 * LogoWordmark — Texto "LISTO POS LITE" en tipografía de la marca.
 * Para cabeceras y pantallas donde no cabe la imagen completa.
 */
export const LogoWordmark = ({ className = '' }) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <LogoIcon className="w-8 h-8" />
      <div className="flex flex-col leading-none">
        <span className="text-base font-black tracking-tight text-[#334155]">
          LISTO <span className="text-[#0EA5E9]">POS</span>
        </span>
        <span className="text-[8px] font-bold uppercase tracking-[0.25em] text-[#5EEAD4]">
          Lite
        </span>
      </div>
    </div>
  );
};

export default LogoFull;
