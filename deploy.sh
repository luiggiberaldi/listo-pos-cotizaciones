#!/bin/bash
# deploy.sh — Build and deploy with secrets injected via --var
# Secrets are read from .env.secrets (gitignored, never committed)
set -e

if [ ! -f .env.secrets ]; then
  echo "⚠️  .env.secrets no encontrado — desplegando sin secrets"
  bun run build && wrangler deploy --dispatch-namespace chiridion
  exit 0
fi

# Load secrets
set -a && source .env.secrets && set +a

# Build
npm run build

# Deploy with secrets as --var overrides
wrangler deploy --dispatch-namespace chiridion \
  --var SUPABASE_SERVICE_KEY:"$SUPABASE_SERVICE_KEY" \
  --var VAPID_PUBLIC_KEY:"$VAPID_PUBLIC_KEY" \
  --var VAPID_PRIVATE_KEY:"$VAPID_PRIVATE_KEY" \
  --var GROQ_KEYS_A:"$GROQ_KEYS_A" \
  --var GROQ_KEYS_B:"$GROQ_KEYS_B" \
  --var GROQ_KEYS_C:"$GROQ_KEYS_C"

echo "✅ Desplegado con secrets inyectados"
