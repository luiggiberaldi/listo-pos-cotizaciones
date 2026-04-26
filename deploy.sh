#!/bin/bash
# deploy.sh — Inyecta secrets de .dev.vars en wrangler.jsonc, despliega y restaura
set -e

if [ ! -f .dev.vars ]; then
  echo "⚠️  .dev.vars no encontrado — desplegando sin Groq keys"
  bun run build && wrangler deploy --dispatch-namespace chiridion
  exit 0
fi

# Leer keys de .dev.vars (export para que node las herede)
set -a && source .dev.vars && set +a

# Backup
cp wrangler.jsonc wrangler.jsonc.bak

# Inyectar keys reales temporalmente
node -e "
const fs = require('fs');
let f = fs.readFileSync('wrangler.jsonc','utf8');
f = f.replace('\"GROQ_KEYS_A\": \"\"', '\"GROQ_KEYS_A\": \"'+(process.env.GROQ_KEYS_A||'')+'\"');
f = f.replace('\"GROQ_KEYS_B\": \"\"', '\"GROQ_KEYS_B\": \"'+(process.env.GROQ_KEYS_B||'')+'\"');
f = f.replace('\"GROQ_KEYS_C\": \"\"', '\"GROQ_KEYS_C\": \"'+(process.env.GROQ_KEYS_C||'')+'\"');
fs.writeFileSync('wrangler.jsonc', f);
"

# Build y deploy
bun run build
wrangler deploy --dispatch-namespace chiridion

# Restaurar wrangler.jsonc sin secrets
mv wrangler.jsonc.bak wrangler.jsonc

echo "✅ Desplegado con Groq keys inyectadas"
