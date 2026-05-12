# deploy.ps1 - Usar variables de entorno o .env.secrets (no incluir claves directamente)
# Copiar .env.secrets.example a .env.secrets y rellenar los valores

if (-not $env:SUPABASE_SERVICE_KEY) {
    Write-Error "Falta SUPABASE_SERVICE_KEY. Configura tus variables de entorno."
    exit 1
}

npx wrangler deploy `
    --var SUPABASE_SERVICE_KEY:$env:SUPABASE_SERVICE_KEY `
    --var VAPID_PUBLIC_KEY:$env:VAPID_PUBLIC_KEY `
    --var VAPID_PRIVATE_KEY:$env:VAPID_PRIVATE_KEY `
    --var GROQ_KEYS_A:$env:GROQ_KEYS_A `
    --var GROQ_KEYS_B:$env:GROQ_KEYS_B `
    --var GROQ_KEYS_C:$env:GROQ_KEYS_C
