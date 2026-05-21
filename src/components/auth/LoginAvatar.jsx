// src/components/auth/LoginAvatar.jsx
// Paleta corporativa oscura — profesional/enterprise
const COLORES_ROL = {
  supervisor: {
    from: '#1e4a7a', to: '#0f2d52',
    border: 'rgba(59,130,246,0.5)',
    shadow: '#0a1f3a',
    shadowGlow: 'rgba(59,130,246,0.25)',
    accent: '#3b82f6',
  },
  vendedor: {
    from: '#0f4a42', to: '#062e28',
    border: 'rgba(20,184,166,0.5)',
    shadow: '#041e1a',
    shadowGlow: 'rgba(20,184,166,0.2)',
    accent: '#14b8a6',
  },
}

const COLOR_PLATEADO = '#E2E8F0'
const COLOR_DORADO = '#D4AF37'

function hexVariants(hex) {
  const r = parseInt(hex.slice(1,3), 16)
  const g = parseInt(hex.slice(3,5), 16)
  const b = parseInt(hex.slice(5,7), 16)
  const darker  = `rgb(${Math.max(r-50,0)},${Math.max(g-50,0)},${Math.max(b-50,0)})`
  const darkest = `rgb(${Math.max(r-80,0)},${Math.max(g-80,0)},${Math.max(b-80,0)})`
  const glow    = `rgba(${r},${g},${b},0.25)`
  const border  = `rgba(${Math.min(r+40,255)},${Math.min(g+40,255)},${Math.min(b+40,255)},0.5)`
  return { from: darker, to: darkest, border, shadow: darkest, shadowGlow: glow, accent: hex }
}

export default function LoginAvatar({ user, size = 'lg', className = '' }) {
  const inicial = (user?.nombre || 'U').charAt(0).toUpperCase()

  const esPlateado = ['administracion', 'logistica'].includes(user?.rol)
  const esDorado = user?.rol === 'jefe'
  const esVendedorExterno = ['vendedor', 'vendedor_sin_comision'].includes(user?.rol) && (!!user?.es_externo || Number(user?.markup_pct) > 0)

  const v = esPlateado 
    ? {
        background: 'linear-gradient(135deg, #E8ECF1 0%, #C0C7D0 25%, #A8B2BE 45%, #D6DCE3 60%, #8A95A3 80%, #6B7785 100%)',
        border: 'rgba(192,199,208,0.8)',
        shadow: '#4a5568',
        shadowGlow: 'rgba(160,174,192,0.45)',
        accent: '#CBD5E1',
        darkText: true,
      }
    : (esDorado 
        ? {
            background: 'linear-gradient(135deg, #BF953F 0%, #FCF6BA 45%, #B38728 70%, #AA771C 100%)',
            border: 'rgba(184,134,11,0.6)',
            shadow: '#5e4406',
            shadowGlow: 'rgba(184,134,11,0.3)',
            accent: '#BF953F'
          }
        : (esVendedorExterno
            ? {
                background: 'linear-gradient(135deg, #B45309 0%, #FCF6BA 45%, #D97706 70%, #78350F 100%)',
                border: 'rgba(217,119,6,0.6)',
                shadow: '#451a03',
                shadowGlow: 'rgba(217,119,6,0.3)',
                accent: '#D97706'
              }
            : (user?.color ? hexVariants(user.color) : (COLORES_ROL[user?.rol] ?? COLORES_ROL.vendedor))))

  const dim = size === 'lg'
    ? 'w-20 h-20 sm:w-[88px] sm:h-[88px] text-3xl sm:text-4xl'
    : 'w-10 h-10 text-base'

  return (
    <div
      className={`${dim} rounded-2xl flex items-center justify-center text-white font-black select-none transition-all relative overflow-hidden ${className}`}
      style={{
        background: v.background || `linear-gradient(145deg, ${v.from}, ${v.to})`,
        border: `1px solid ${v.border}`,
        boxShadow: `0 4px 0 ${v.shadow}, 0 8px 32px ${v.shadowGlow}, inset 0 1px 0 rgba(255,255,255,0.1)`,
      }}
    >
      {/* Brillo interno sutil */}
      <div className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{ background: 'linear-gradient(145deg, rgba(255,255,255,0.08) 0%, transparent 60%)' }} />
      <span className="relative z-10 tracking-tight" style={{ textShadow: v.darkText ? 'none' : '0 2px 8px rgba(0,0,0,0.4)', color: v.darkText ? '#1e293b' : '#ffffff' }}>
        {inicial}
      </span>
    </div>
  )
}
