// src/services/supabase/adminClient.js
// Cliente con service_role — SOLO para operaciones de admin (crear/invitar usuarios)
// Requiere VITE_SUPABASE_SERVICE_KEY en .env
// NOTA: Esta key nunca debe exponerse en una app pública.
//       Este sistema es de uso interno (solo accede el supervisor), por lo que
//       es aceptable en esta arquitectura de MVP.
import { createClient } from '@supabase/supabase-js'

const supabaseUrl    = import.meta.env.VITE_SUPABASE_URL
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY

export function getAdminClient() {
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export const hasAdminKey = !!(supabaseUrl && serviceRoleKey)
