// Verificar estructura de cotizaciones para encontrar el campo vendedor correcto
const SUPABASE_URL = 'https://oyfyuszgjwcepjpngclv.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95Znl1c3pnandjZXBqcG5nY2x2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQyOTQ0MywiZXhwIjoyMDkxMDA1NDQzfQ.YoMbefzmBd7gbhRQeVNCagSXte_87OQIeYkwCasD8wk'
const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

async function run() {
  // Ver una cotización para encontrar el campo del vendedor
  const r = await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?select=*&limit=1`, { headers: h })
  const d = await r.json()
  if (Array.isArray(d) && d.length > 0) {
    console.log('Columnas de cotizaciones:', Object.keys(d[0]).join(', '))
  }
  
  // Ver una comisión
  const r2 = await fetch(`${SUPABASE_URL}/rest/v1/comisiones?select=*&limit=1`, { headers: h })
  const d2 = await r2.json()
  if (Array.isArray(d2) && d2.length > 0) {
    console.log('\nColumnas de comisiones:', Object.keys(d2[0]).join(', '))
    console.log('Ejemplo comisión:', JSON.stringify(d2[0], null, 2))
  }
  
  // Ver notas_despacho
  const r3 = await fetch(`${SUPABASE_URL}/rest/v1/notas_despacho?select=*&limit=1`, { headers: h })
  const d3 = await r3.json()
  if (Array.isArray(d3) && d3.length > 0) {
    console.log('\nColumnas de notas_despacho:', Object.keys(d3[0]).join(', '))
  }
}
run().catch(console.error)
