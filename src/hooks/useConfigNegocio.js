// src/hooks/useConfigNegocio.js
// Configuración del negocio para header del PDF y ajustes globales
// — select explícito SIN gate_password_hash
// — gate se valida server-side vía RPCs SECURITY DEFINER
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'

const KEY = ['config_negocio']

// Columnas seguras (excluye gate_password_hash)
const CONFIG_COLUMNS = 'id, nombre_negocio, rif_negocio, telefono_negocio, direccion_negocio, email_negocio, logo_url, moneda_principal, validez_cotizacion_dias, pie_pagina_pdf, tasa_bcv_manual, iva_pct, gate_email, comision_pct_cabilla, comision_pct_otros, comision_categoria_cabilla, creado_en, actualizado_en'

export function useConfigNegocio() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configuracion_negocio')
        .select(CONFIG_COLUMNS)
        .eq('id', 1)
        .single()

      if (error) {
        if (error.code === 'PGRST116') return {}
        throw error
      }
      return data ?? {}
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000, // config rarely changes, keep in cache 30 min
  })
}

// ─── Guardar configuración (vía Worker backend — bypass RLS) ─────────────────
export function useActualizarConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campos) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/admin/config'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(campos),
      })
      if (!res.ok) {
        const text = await res.text()
        let data = {}
        try { data = JSON.parse(text) } catch {}
        throw new Error(data.error || text || `Error ${res.status}`)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// ─── Validar gate de acceso (server-side via RPC) ──────────────────────────────
// El hash NUNCA sale de la BD — se compara server-side

async function hashSHA256(text) {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function validarGate(emailInput, passwordInput) {
  const inputHash = await hashSHA256(passwordInput)
  const { data, error } = await supabase.rpc('validar_gate_acceso', {
    p_email: emailInput.trim(),
    p_password_hash: inputHash,
  })

  if (error) {
    return { ok: false, error: 'No se pudo verificar el acceso' }
  }

  // data es boolean: true = acceso permitido
  if (!data) {
    return { ok: false, error: 'Correo o contraseña incorrectos' }
  }

  return { ok: true }
}

export async function tieneGateConfigurado() {
  const { data, error } = await supabase.rpc('tiene_gate_configurado')
  if (error) return false
  return !!data
}

export { hashSHA256 }
