// src/components/auth/LoginAvatar.jsx
// Avatar de usuario para la pantalla de selección — estilo Listo POS Lite
const COLORES = {
  supervisor: {
    bg: 'bg-gradient-to-b from-sky-400 to-sky-600 border-t-2 border-sky-300',
    sombra: '0 6px 0 #0369a1, 0 12px 25px rgba(14,165,233,0.4)',
  },
  vendedor: {
    bg: 'bg-gradient-to-b from-teal-400 to-teal-600 border-t-2 border-teal-300',
    sombra: '0 6px 0 #0f766e, 0 12px 25px rgba(20,184,166,0.4)',
  },
}

export default function LoginAvatar({ user, size = 'lg', className = '' }) {
  const inicial = (user?.nombre || 'U').charAt(0).toUpperCase()
  const c = COLORES[user?.rol] ?? COLORES.vendedor
  const dim = size === 'lg'
    ? 'w-20 h-20 sm:w-24 sm:h-24 text-4xl'
    : 'w-10 h-10 text-base'

  return (
    <div
      className={`${dim} rounded-[1.25rem] ${c.bg} flex items-center justify-center text-white font-black select-none transition-all ${className}`}
      style={{ boxShadow: c.sombra }}
    >
      {inicial}
    </div>
  )
}
