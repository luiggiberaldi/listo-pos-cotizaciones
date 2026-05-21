const SUPABASE_URL = 'https://oyfyuszgjwcepjpngclv.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95Znl1c3pnandjZXBqcG5nY2x2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQyOTQ0MywiZXhwIjoyMDkxMDA1NDQzfQ.YoMbefzmBd7gbhRQeVNCagSXte_87OQIeYkwCasD8wk'
const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

async function run() {
  console.log("=== ACTIVANDO CLIENTE PRUEBA ===");
  const clienteId = "59848e72-6b5e-444a-abf0-a4efbae4e0d4";
  
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
    method: 'PATCH',
    headers: { ...h, Prefer: 'return=representation' },
    body: JSON.stringify({
      activo: true
    })
  });

  if (!patchRes.ok) {
    throw new Error(`Error al activar cliente: ${await patchRes.text()}`);
  }
  const data = await patchRes.json();
  console.log("Cliente activado con éxito! Respuesta:");
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
