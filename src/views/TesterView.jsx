// src/views/TesterView.jsx
// Vista independiente del Tester — accesible desde el sidebar
import { FlaskConical, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import TesterPanel from '../components/tester/TesterPanel'

export default function TesterView() {
  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">
      <PageHeader
        icon={FlaskConical}
        title="Tester del Sistema"
        subtitle="Datos demo, stress test y métricas de rendimiento"
      />
      <Link to="/tester-flow"
        className="flex items-center justify-between p-4 rounded-xl bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-colors group">
        <div>
          <p className="text-sm font-bold text-indigo-700">Tester Determinista (64 pasos)</p>
          <p className="text-xs text-indigo-500 mt-0.5">Flujo completo con aserciones exactas: producto → cotización → despacho → descuentos → comisión → CxC → transportistas → venta rápida → anulación → reciclaje</p>
        </div>
        <ArrowRight size={18} className="text-indigo-400 group-hover:translate-x-1 transition-transform shrink-0" />
      </Link>
      <TesterPanel />
    </div>
  )
}
