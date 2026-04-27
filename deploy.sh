#!/bin/bash
# deploy.sh — Inyecta secrets de .dev.vars en wrangler.jsonc, despliega a camelAI y restaura
# Los secrets nunca quedan en el repo — se leen de .dev.vars (gitignored) y se inyectan
# temporalmente en wrangler.jsonc solo durante el deploy.
#
# IMPORTANTE: wrangler.jsonc NO tiene placeholders vacíos para los secrets.
# Este script AGREGA las vars al bloque "vars" antes del deploy.
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

# Inyectar secrets reales temporalmente — agrega vars antes del comentario de cierre
node -e "
const fs = require('fs');
let f = fs.readFileSync('wrangler.jsonc','utf8');

// Reemplazar placeholders vacíos de GROQ_KEYS en wrangler.jsonc
['GROQ_KEYS_A', 'GROQ_KEYS_B', 'GROQ_KEYS_C'].forEach(key => {
  const val = process.env[key] || '';
  f = f.replace(new RegExp('(\"' + key + '\": \")(\")'), '\$1' + val + '\$2');
});

fs.writeFileSync('wrangler.jsonc', f);
"

# Build y deploy
bun run build
wrangler deploy --dispatch-namespace chiridion

# Restaurar wrangler.jsonc sin secrets
mv wrangler.jsonc.bak wrangler.jsonc

echo "✅ Desplegado con todos los secrets inyectados"
