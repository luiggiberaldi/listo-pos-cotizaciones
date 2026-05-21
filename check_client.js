const SUPABASE_URL = 'https://oyfyuszgjwcepjpngclv.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95Znl1c3pnandjZXBqcG5nY2x2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQyOTQ0MywiZXhwIjoyMDkxMDA1NDQzfQ.YoMbefzmBd7gbhRQeVNCagSXte_87OQIeYkwCasD8wk'
const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

async function run() {
  console.log("=== BUSCANDO CLIENTES QUE SE LLAMEN PRUEBA ===");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes?nombre=ilike.*Prueba*&select=*`, { headers: h });
  const data = await r.json();
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
