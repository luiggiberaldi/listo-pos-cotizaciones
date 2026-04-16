// src/components/auth/LoginAvatar.jsx
// Avatar de usuario para la pantalla de selección — estilo Listo POS Lite

// Colores de respaldo por rol (cuando el usuario no tiene color asignado)
const COLORES_ROL = {
  supervisor: { from: '#38bdf8', to: '#0284c7', border: '#7dd3fc', shadow: '#0369a1', shadowGlow: 'rgba(14,165,233,0.4)' },
  vendedor:   { from: '#2dd4bf', to: '#0f766e', border: '#5eead4', shadow: '#0f766e', shadowGlow: 'rgba(20,184,166,0.4)' },
}

// Convierte un color hex a versiones más clara/oscura
function hexVariants(hex) {
  const r = parseInt(hex.slice(1,3), 16)
  const g = parseInt(hex.slice(3,5), 16)
  const b = parseInt(hex.slice(5,7), 16)
  const lighter = `rgba(${Math.min(r+60,255)},${Math.min(g+60,255)},${Math.min(b+60,255)},1)`
  const darker  = `rgba(${Math.max(r-40,0)},${Math.max(g-40,0)},${Math.max(b-40,0)},1)`
  const glow    = `rgba(${r},${g},${b},0.4)`
  return { from: lighter, to: hex, border: lighter, shadow: darker, shadowGlow: glow }
}

export default function LoginAvatar({ user, size = 'lg', className = '' }) {
  const inicial = (user?.nombre || 'U').charAt(0).toUpperCase()

  const v = user?.color
    ? hexVariants(user.color)
    : (COLORES_ROL[user?.rol] ?? COLORES_ROL.vendedor)

  const dim = size === 'lg'
    ? 'w-20 h-20 sm:w-24 sm:h-24 text-4xl'
    : 'w-10 h-10 text-base'

  return (
    <div
      className={`${dim} rounded-[1.25rem] flex items-center justify-center text-white font-black select-none transition-all ${className}`}
      style={{
        background: `linear-gradient(to bottom, ${v.from}, ${v.to})`,
        borderTop: `2px solid ${v.border}`,
        boxShadow: `0 6px 0 ${v.shadow}, 0 12px 25px ${v.shadowGlow}`,
      }}
    >
      {inicial}
    </div>
  )
}
