// src/components/cotizaciones/QuickQuoteFAB.jsx
// Floating Action Button para acceso rápido a cotización rápida (solo móvil)
import { useNavigate, useLocation } from 'react-router-dom'
import { Zap } from 'lucide-react'

export default function QuickQuoteFAB() {
  const navigate = useNavigate()
  const location = useLocation()

  // No mostrar en cotizaciones (ya tiene el botón), ni en login
  const hiddenPaths = ['/cotizaciones', '/login']
  if (hiddenPaths.some(p => location.pathname.startsWith(p))) return null

  return (
    <button
      onClick={() => navigate('/cotizaciones?rapida=1')}
      className="fixed bottom-20 right-4 z-[90] md:hidden w-14 h-14 rounded-full flex items-center justify-center shadow-xl active:scale-90 transition-all"
      style={{
        background: 'linear-gradient(135deg, #1B365D, #B8860B)',
        boxShadow: '0 6px 24px rgba(27,54,93,0.4)',
      }}
      title="Cotización Rápida"
    >
      <Zap size={22} className="text-white" fill="white" fillOpacity={0.2} />
    </button>
  )
}
