import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import EditarPagoEntregadoModal from '../../../src/components/despachos/EditarPagoEntregadoModal.jsx'
import { ToastProvider } from '../../../src/components/ui/Toast.jsx'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
window.__pagosRequests = []

// Escenario A — despacho entregado: total $500 = $200 pagados + $300 de Cobro a destino
// YA PAGADO (el caso más exigente: la entrada COD debe viajar intacta byte a byte).
const COD_ENTRADA = { metodo: 'Cobro a destino', monto: 300, cobro_destino_pagado: true, metodo_propuesto: [{ metodo: 'Efectivo Bs', monto: 300 }] }
window.__codEntradaOriginal = JSON.stringify(COD_ENTRADA)
const FORMAS = JSON.stringify([{ metodo: 'Efectivo $', monto: 200 }, COD_ENTRADA])

const despachoSimple = {
  id: 'fixture-entregado-1',
  numero: 14200,
  estado: 'entregada',
  total_usd: 500,
  forma_pago: FORMAS,
  forma_pago_cliente: FORMAS,
  referencia_pago: 'FOLIO-1',
}

// Escenario B — despacho entregado con parte a crédito (CxC): total $650 =
// $100 efectivo + $350 "Cta por cobrar" (30 días) + $200 COD pendiente. El mock de
// resumen-financiero reporta deuda CxC de $250 para este despacho.
const FORMAS_CXC = JSON.stringify([
  { metodo: 'Efectivo $', monto: 100 },
  { metodo: 'Cta por cobrar', monto: 350, diasVencimiento: 30 },
  { metodo: 'Cobro a destino', monto: 200, cobro_destino_pagado: false, metodo_propuesto: [] },
])

const despachoConCxc = {
  id: 'fixture-cxc-1',
  numero: 14300,
  estado: 'entregada',
  cliente_id: 'cliente-fixture-cxc',
  creado_en: '2026-10-01T10:00:00.000Z',
  total_usd: 650,
  forma_pago: FORMAS_CXC,
  forma_pago_cliente: FORMAS_CXC,
  referencia_pago: '',
}

export function EditarPagoFixture() {
  const [isOpen, setIsOpen] = useState(true)
  const [despacho, setDespacho] = useState(despachoSimple)

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <main>
          <button type="button" onClick={() => { setDespacho(despachoConCxc); setIsOpen(true) }}>
            Cargar despacho con CxC
          </button>
          {!isOpen && <button type="button" onClick={() => setIsOpen(true)}>Abrir edición de pago</button>}
          <EditarPagoEntregadoModal
            isOpen={isOpen}
            onClose={() => { window.__pagosClosed = true; setIsOpen(false) }}
            despacho={despacho}
          />
        </main>
      </ToastProvider>
    </QueryClientProvider>
  )
}

createRoot(document.getElementById('root')).render(<EditarPagoFixture />)
