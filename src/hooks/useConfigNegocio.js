// src/hooks/useConfigNegocio.js
// Configuración del negocio para header del PDF y ajustes globales
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'

const KEY = ['config_negocio']

export function useConfigNegocio() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configuracion_negocio')
        .select('*')
        .eq('id', 1)
        .single()

      if (error) {
        if (error.code === 'PGRST116') return {}
        throw error
      }
      return data ?? {}
    },
    staleTime: 5 * 60 * 1000,
  })
}

// ─── Guardar configuración (upsert sobre id = 1) ──────────────────────────────
export function useActualizarConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campos) => {
      const { error } = await supabase
        .from('configuracion_negocio')
        .upsert({ id: 1, ...campos }, { onConflict: 'id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// ─── Validar gate de acceso (paso 1 del login) ────────────────────────────────
// Lee gate_email y gate_password_hash de configuracion_negocio
// Compara email + SHA-256 del password ingresado contra lo almacenado
// Usa la anon key (no requiere sesión autenticada) — la tabla permite SELECT
// público para estos campos específicos

async function hashSHA256(text) {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function validarGate(emailInput, passwordInput) {
  const { data, error } = await supabase
    .from('configuracion_negocio')
    .select('gate_email, gate_password_hash')
    .eq('id', 1)
    .single()

  if (error || !data) {
    return { ok: false, error: 'No se pudo verificar el acceso' }
  }

  // Si no hay gate configurado, dejar pasar (primera vez)
  if (!data.gate_email || !data.gate_password_hash) {
    return { ok: true }
  }

  const emailOk = emailInput.trim().toLowerCase() === data.gate_email.trim().toLowerCase()
  const inputHash = await hashSHA256(passwordInput)
  const passOk = inputHash === data.gate_password_hash

  if (!emailOk || !passOk) {
    return { ok: false, error: 'Correo o contraseña incorrectos' }
  }

  return { ok: true }
}

export { hashSHA256 }
