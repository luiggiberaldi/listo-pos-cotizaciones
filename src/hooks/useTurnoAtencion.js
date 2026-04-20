// src/hooks/useTurnoAtencion.js
// Calcula el turno de atención diario (L-S) con round-robin
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'

// Fecha base para el cálculo (1 enero 2025)
const FECHA_BASE = new Date(2025, 0, 1)

// Cuenta días laborables (L-S) entre dos fechas
function diasLaborables(desde, hasta) {
  let count = 0
  const d = new Date(desde)
  d.setHours(0, 0, 0, 0)
  const h = new Date(hasta)
  h.setHours(0, 0, 0, 0)
  while (d < h) {
    if (d.getDay() !== 0) count++ // 0 = domingo
    d.setDate(d.getDate() + 1)
  }
  return count
}

// Calcula turno para una fecha dada
function calcularTurno(vendedores, fecha) {
  if (!vendedores?.length) return null
  if (fecha.getDay() === 0) return null // domingo
  const dias = diasLaborables(FECHA_BASE, fecha)
  return vendedores[dias % vendedores.length]
}

// Genera calendario de la semana actual (L-S)
function generarCalendarioSemana(vendedores, hoy) {
  const dias = []
  // Encontrar el lunes de esta semana
  const d = new Date(hoy)
  const dow = d.getDay() // 0=dom, 1=lun...
  const diffToLunes = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + diffToLunes)
  d.setHours(0, 0, 0, 0)

  // L-S = 6 días
  for (let i = 0; i < 6; i++) {
    const fecha = new Date(d)
    const vendedor = calcularTurno(vendedores, fecha)
    const esHoy = fecha.toDateString() === hoy.toDateString()
    dias.push({
      fecha,
      diaSemana: fecha.toLocaleDateString('es-VE', { weekday: 'short' }),
      diaNum: fecha.getDate(),
      vendedor,
      esHoy,
    })
    d.setDate(d.getDate() + 1)
  }
  return dias
}

export function useTurnoAtencion() {
  const { perfil } = useAuthStore()

  const { data: vendedores, isLoading } = useQuery({
    queryKey: ['turno_vendedores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nombre, color')
        .eq('rol', 'vendedor')
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data ?? []
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  })

  const resultado = useMemo(() => {
    if (!vendedores?.length) return { vendedorHoy: null, calendario: [], esDomingo: false }
    const hoy = new Date()
    const esDomingo = hoy.getDay() === 0
    const vendedorHoy = calcularTurno(vendedores, hoy)
    const calendario = generarCalendarioSemana(vendedores, hoy)
    return { vendedorHoy, calendario, esDomingo }
  }, [vendedores])

  return { ...resultado, vendedores, isLoading }
}
