const fs = require('fs');
const content = fs.existsSync('.dev.vars') ? fs.readFileSync('.dev.vars', 'utf8') : (fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '');
const urlMatch = content.match(/SUPABASE_URL\s*=\s*"?([^"\n]+)"?/);
const keyMatch = content.match(/SUPABASE_SERVICE_KEY\s*=\s*"?([^"\n]+)"?/);
if (urlMatch && keyMatch) {
  fetch(urlMatch[1] + '/rest/v1/comisiones?select=vendedor_id,cotizacion_id,total_comision,despacho_id&limit=5&order=creado_en.desc', {
    headers: { apikey: keyMatch[1], Authorization: 'Bearer ' + keyMatch[1] }
  }).then(r => r.json()).then(console.log).catch(console.error);
} else {
  console.log('Env vars not found in .dev.vars or .env');
}
