// diagnostico_des688.js
// Ejecutar con: node diagnostico_des688.js

const SUPABASE_URL = 'https://oyfyuszgjwcepjpngclv.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95Znl1c3pnandjZXBqcG5nY2x2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQyOTQ0MywiZXhwIjoyMDkxMDA1NDQzfQ.YoMbefzmBd7gbhRQeVNCagSXte_87OQIeYkwCasD8wk'
const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

async function run() {
  // 1. Buscar por numero 688
  console.log('=== Buscando DES-00688 ===')
  const r1 = await fetch(`${SUPABASE_URL}/rest/v1/notas_despacho?numero=eq.688&select=id,numero,estado,tiene_prestamos,vendedor_id,cliente_id,total_usd,creado_en,actualizado_en`, { headers: h })
  const despachos = await r1.json()
  console.log(JSON.stringify(despachos, null, 2))

  if (despachos.length === 0) {
    console.log('\n❌ El despacho DES-00688 NO EXISTE en la base de datos o fue eliminado.')
    return
  }

  const d = despachos[0]
  console.log(`\n✅ Encontrado: estado=${d.estado} | tiene_prestamos=${d.tiene_prestamos} | total=${d.total_usd}`)

  // 2. Ver sus items
  console.log('\n=== Ítems del despacho ===')
  const r2 = await fetch(`${SUPABASE_URL}/rest/v1/notas_despacho_items?despacho_id=eq.${d.id}&select=id,nombre_snap,cantidad,precio_unit_usd,total_linea_usd,es_prestamo`, { headers: h })
  const items = await r2.json()
  console.log(JSON.stringify(items, null, 2))
}

run().catch(console.error)
