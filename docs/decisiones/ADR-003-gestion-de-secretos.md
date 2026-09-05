# ADR-003: Gestión de secretos

- Estado: Aceptado (formaliza las reglas aprendidas en el incidente INC-003)
- Fecha: 2026-04-26 (auditoría de seguridad); refinado con el CI/CD actual de `deploy-worker.yml`
- Decisores: Propietario del proyecto + auditoría de seguridad
- Contexto:
  - El sistema tiene tres superficies de despliegue que necesitan credenciales: Cloudflare Workers (runtime), GitHub Actions (CI/CD) y desarrollo local (`deploy.sh` hacia camelAI con `.dev.vars`).
  - Incidente: placeholders vacíos en `wrangler.jsonc` **sobrescribieron y destruyeron 5 secrets del Dashboard** (`GROQ_KEYS_A/B/C`, `SUPABASE_SERVICE_KEY`, `VAPID_PRIVATE_KEY`), produciendo errores 500 en producción (`docs/incidentes/INC-003-secrets-sobrescritos-en-deploy.md`).
  - También hubo credenciales versionadas por error (`.env.production`, `.env.bak`) y un código de super admin hardcodeado en `worker.js`.
- Decisión:
  1. **Ubicación canónica de los secretos** (nunca en el repositorio):
     - **Cloudflare Dashboard**: runtime del Worker (`SUPABASE_SERVICE_KEY`, `VAPID_PRIVATE_KEY`, `DEV_SUPER_CODE` como secrets; `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY` como texto plano no sensible).
     - **GitHub Secrets**: los que necesita el CI/CD (`CF_API_TOKEN`, `CF_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `DEV_SUPER_CODE`, pools de Groq si aplican).
     - **`.dev.vars` local**: solo para el deploy de desarrollo a camelAI; gitignoreado.
  2. **`wrangler.jsonc` solo contiene vars públicas.** Prohibido poner `"CLAVE": ""`: una variable vacía sobrescribe el secret del Dashboard. Los scripts de deploy **agregan** secrets dinámicamente si el flujo lo requiere; jamás reemplazan con strings vacíos.
  3. **El workflow valida antes de desplegar**: `test -n` fail-fast para cada secret requerido y los inyecta con `wrangler secret put` (stdout pipe), no como vars planas.
  4. **El código nunca hardcodea credenciales**: `SUPER_ADMIN_CODE` se lee de `env.DEV_SUPER_CODE`; el frontend valida el super PIN contra el servidor (`/api/auth/super-admin`), nunca localmente.
  5. **Verificación pos-cambio de estrategia**: endpoint de diagnóstico que reporta **longitudes** de secrets (jamás valores).
- Consecuencias:
  - Positivas: los deploys ya no destruyen secretos; rotación posible sin tocar el repo; el código filtrado desapareció del historial activo (`git rm --cached` + `.gitignore`).
  - De costo: un secret nuevo hay que registrarlo en hasta 3 lugares; sin su endpoint de diagnóstico no hay visibilidad de qué entorno quedó mal.
- Alternativas consideradas:
  - Secrets solo en `wrangler.jsonc` — descartado: quedan expuestos en el repo y sobrescriben el Dashboard.
  - Un único almacén (solo Dashboard) — insuficiente: CI/CD necesita inyectarlos sin interacción humana.
- Referencias:
  - `docs/incidentes/INC-003-secrets-sobrescritos-en-deploy.md`
  - `docs/incidentes/INC-002-worker-desactualizado-y-401.md`
  - `.github/workflows/deploy-worker.yml` (fuente de verdad operativa del flujo)
  - `docs/runbooks/deploy-produccion.md`
