# ADR-001: Arquitectura de deploy y separación de entornos

- Estado: Aceptado (reemplaza decisiones históricas de deploy manual y de camelAI como backend primario)
- Fecha: 2026-04-24 (automatización CI/CD); consolidado 2026-09-05
- Decisores: Propietario del proyecto + sesiones de auditoría (bitácora 24–26/04/2026)
- Contexto:
  - El frontend en producción corre en Vercel (`listo-pos-cotizaciones.vercel.app`), auto-deploy desde `main`.
  - El backend es un Cloudflare Worker (`worker.js`) con rutas `/api/*`; `vercel.json` hace proxy de `/api/*` al Worker primario en `luigistorelogistics.workers.dev`.
  - Existe un árbol espejo de staging (`construacero-staging/`) con su propio proyecto Supabase, `wrangler.toml`, Vercel y suite E2E (123 pasos), más E2E nocturno programado (`.github/workflows/staging-e2e-nightly.yml`, 05:00 UTC).
  - Incidentes que motivaron la decisión: deploy manual del Worker que dejó producción desactualizada con errores 401 (`docs/incidentes/INC-002-worker-desactualizado-y-401.md`) y un Worker secundario sin secrets que devolvía 500.
- Decisión:
  1. **Vercel** despliega automáticamente el frontend en cada push a `main`; es el primario y la URL que usan los usuarios finales.
  2. **GitHub Actions** (`.github/workflows/deploy-worker.yml`) despliega automáticamente el Worker a `workers.dev` en cada push a `main`, con validación fail-fast de secrets y `wrangler secret put` (nunca vars planas para secretos).
  3. **El proxy de `vercel.json` apunta al Worker primario** (`luigistorelogistics.workers.dev`), jamás al Worker de camelAI (no tiene secrets → 500).
  4. Staging es un árbol y proyecto independientes; nada se promueve a producción sin pasar por staging (ver `docs/runbooks/promocion-release.md`).
- Consecuencias:
  - Positivas: fin de los desajustes frontend/Worker; deploys reproducibles; smoke tests estandarizados post-deploy.
  - De costo: todo cambio de infra pasa por CI (no deploys manuales "rápidos"), y los dos árboles (principal/staging) deben mantenerse en paridad documentada (`docs/operaciones/matriz-migraciones.md`).
  - Riesgo vigilado: Workers duplicados en la cuenta de Cloudflare (histórico: `construacerocarabobo`); limpieza manual pendiente en Dashboard.
- Alternativas consideradas:
  - Deploy manual con `wrangler deploy` — descartada: fue la causa raíz de INC-002.
  - Frontend llamando cross-origin al Worker de camelAI con `VITE_WORKER_ORIGIN` — 🗃️ **Decisión histórica reemplazada**: funcionó como mitigación temporal en 24/04/2026, pero camelAI no recibe secrets del Dashboard y hoy la regla es el proxy al Worker primario (ver bitácora, auditoría 26/04/2026).
- Referencias:
  - `docs/incidentes/INC-002-worker-desactualizado-y-401.md`
  - `docs/incidentes/INC-003-secrets-sobrescritos-en-deploy.md`
  - `docs/runbooks/deploy-produccion.md`, `docs/runbooks/deploy-staging.md`
  - `docs/operaciones/matriz-entornos.md`
