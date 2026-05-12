import fs from 'fs';
import { parse } from 'dotenv';
const env = parse(fs.readFileSync('.env'));

async function run() {
  try {
    const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/notas_despacho?numero=eq.00343&select=id,numero,forma_pago,total_usd`, {
      headers: {
        'apikey': env.VITE_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${env.VITE_SUPABASE_ANON_KEY}`
      }
    });
    const despachos = await res.json();
    console.log("Despachos:", JSON.stringify(despachos, null, 2));

    if (despachos.length > 0) {
      const cRes = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/comisiones?despacho_id=eq.${despachos[0].id}`, {
        headers: {
          'apikey': env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${env.VITE_SUPABASE_ANON_KEY}`
        }
      });
      const comisiones = await cRes.json();
      console.log("Comisiones:", JSON.stringify(comisiones, null, 2));
    }
  } catch(e) {
    console.error(e);
  }
}
run();
