import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ConciliarCodModal from '../../../src/components/despachos/ConciliarCodModal.jsx'
import { ToastProvider } from '../../../src/components/ui/Toast.jsx'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
window.__codRequests = []
window.__codLedger = { payments: [] }

export function CodModalFixture() {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <main>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('cod-rate-change', { detail: { rate: 4 } }))}>
          Cambiar tasa de prueba a 4 Bs/$
        </button>
        {!isOpen && <button type="button" onClick={() => setIsOpen(true)}>Abrir conciliación COD</button>}
        <ConciliarCodModal
          isOpen={isOpen}
          onClose={() => { window.__codClosed = true; setIsOpen(false) }}
          despacho={{ id: 'fixture-dispatch', numero: 14103 }}
        />
        </main>
      </ToastProvider>
    </QueryClientProvider>
  )
}

createRoot(document.getElementById('root')).render(<CodModalFixture />)
