// src/views/TesterView.jsx
// Vista independiente del Tester — accesible desde el sidebar
import { FlaskConical } from 'lucide-react'
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
      <TesterPanel />
    </div>
  )
}
