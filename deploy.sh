#!/bin/bash
# deploy.sh — Inyecta secrets de .dev.vars en wrangler.jsonc, despliega a camelAI y restaura
# Los secrets nunca quedan en el repo — se leen de .dev.vars (gitignored) y se inyectan
# temporalmente en wrangler.jsonc solo durante el deploy.
set -e

if [ ! -f .dev.vars ]; then
  echo "⚠️  .dev.vars no encontrado — desplegando sin secrets"
  bun run build && wrangler deploy --dispatch-namespace chiridion
  exit 0
fi

# Leer keys de .dev.vars (export para que node las herede)
set -a && source .dev.vars && set +a

# Backup
cp wrangler.jsonc wrangler.jsonc.bak

# Inyectar secrets reales temporalmente
node -e "
const fs = require('fs');
let f = fs.readFileSync('wrangler.jsonc','utf8');
// Groq keys
f = f.replace('\"GROQ_KEYS_A\": \"\"', '\"GROQ_KEYS_A\": \"'+(process.env.GROQ_KEYS_A||'')+'\"');
f = f.replace('\"GROQ_KEYS_B\": \"\"', '\"GROQ_KEYS_B\": \"'+(process.env.GROQ_KEYS_B||'')+'\"');
f = f.replace('\"GROQ_KEYS_C\": \"\"', '\"GROQ_KEYS_C\": \"'+(process.env.GROQ_KEYS_C||'')+'\"');
// Supabase service key + VAPID private key
f = f.replace('\"SUPABASE_SERVICE_KEY\": \"\"', '\"SUPABASE_SERVICE_KEY\": \"'+(process.env.SUPABASE_SERVICE_KEY||'')+'\"');
f = f.replace('\"VAPID_PRIVATE_KEY\": \"\"', '\"VAPID_PRIVATE_KEY\": \"'+(process.env.VAPID_PRIVATE_KEY||'')+'\"');
fs.writeFileSync('wrangler.jsonc', f);
"

# Build y deploy
bun run build
wrangler deploy --dispatch-namespace chiridion

# Restaurar wrangler.jsonc sin secrets
mv wrangler.jsonc.bak wrangler.jsonc

echo "✅ Desplegado con todos los secrets inyectados"
