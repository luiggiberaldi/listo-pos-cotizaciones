import { useEffect, useState } from 'react'

export function useTasaCambio() {
  const [tasaEfectiva, setTasaEfectiva] = useState(2)

  useEffect(() => {
    const cambiarTasa = event => setTasaEfectiva(Number(event.detail.rate))
    window.addEventListener('cod-rate-change', cambiarTasa)
    return () => window.removeEventListener('cod-rate-change', cambiarTasa)
  }, [])

  return {
    tasaEfectiva,
    modoTasa: 'usdt',
    tasaUsdt: { precio: tasaEfectiva, fuente: 'USDT fixture', ultimaActualizacion: '2026-10-02T12:00:00.000Z' },
    tasaBcv: { precio: 0, fuente: 'BCV fixture', ultimaActualizacion: null },
  }
}
