# deploy.ps1 - Windows equivalent of deploy.sh
$ErrorActionPreference = "Stop"

$secretsFile = if (Test-Path .env.secrets) { ".env.secrets" } elseif (Test-Path .dev.vars) { ".dev.vars" } else { $null }

if (!$secretsFile) {
    Write-Host "[WARN] Archivo de secrets no encontrado (.env.secrets ni .dev.vars)" -ForegroundColor Yellow
    exit 1
}

Write-Host "[INFO] Cargando secrets desde $secretsFile..." -ForegroundColor Cyan
Get-Content $secretsFile | ForEach-Object {
    if ($_ -match "^([^=]+)=(.*)$") {
        $name = $Matches[1].Trim()
        $value = $Matches[2].Trim()
        [System.Environment]::SetEnvironmentVariable($name, $value, [System.EnvironmentVariableTarget]::Process)
    }
}

Write-Host "[INFO] Iniciando Deploy a Cloudflare con secrets..." -ForegroundColor Cyan
npx wrangler deploy `
  --var SUPABASE_SERVICE_KEY:"$($env:SUPABASE_SERVICE_KEY)" `
  --var SUPABASE_ANON_KEY:"$($env:SUPABASE_ANON_KEY)" `
  --var DEV_SUPER_CODE:"$($env:DEV_SUPER_CODE)" `
  --var VAPID_PUBLIC_KEY:"$($env:VAPID_PUBLIC_KEY)" `
  --var VAPID_PRIVATE_KEY:"$($env:VAPID_PRIVATE_KEY)" `
  --var GROQ_KEYS_A:"$($env:GROQ_KEYS_A)" `
  --var GROQ_KEYS_B:"$($env:GROQ_KEYS_B)" `
  --var GROQ_KEYS_C:"$($env:GROQ_KEYS_C)"

Write-Host "[OK] Desplegado con todos los secrets inyectados a Cloudflare" -ForegroundColor Green
