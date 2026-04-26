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

// Insertar secrets justo después de la última var existente (DEV_SUPER_CODE line)
const secrets = {
  GROQ_KEYS_A: process.env.GROQ_KEYS_A || '',
  GROQ_KEYS_B: process.env.GROQ_KEYS_B || '',
  GROQ_KEYS_C: process.env.GROQ_KEYS_C || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
};

// Find '\"DEV_SUPER_CODE\": \"..\"' line and add secrets after it
const lines = f.split('\n');
const idx = lines.findIndex(l => l.includes('DEV_SUPER_CODE'));
if (idx === -1) { console.error('DEV_SUPER_CODE not found in wrangler.jsonc'); process.exit(1); }

// Add comma to DEV_SUPER_CODE line if not present
if (!lines[idx].trimEnd().endsWith(',')) {
  lines[idx] = lines[idx].replace(/(\".*)$/, '\$1,');
}

// Build secret lines
const secretLines = Object.entries(secrets)
  .map(([k, v], i, arr) => '    \"' + k + '\": \"' + v + '\"' + (i < arr.length - 1 ? ',' : ''))
  .join('\n');

// Insert after DEV_SUPER_CODE line (skip any comment lines)
let insertAt = idx + 1;
while (insertAt < lines.length && lines[insertAt].trim().startsWith('//')) {
  insertAt++;
}
lines.splice(insertAt, 0, secretLines);

fs.writeFileSync('wrangler.jsonc', lines.join('\n'));
"

# Build y deploy
bun run build
wrangler deploy --dispatch-namespace chiridion

# Restaurar wrangler.jsonc sin secrets
mv wrangler.jsonc.bak wrangler.jsonc

echo "✅ Desplegado con todos los secrets inyectados"
