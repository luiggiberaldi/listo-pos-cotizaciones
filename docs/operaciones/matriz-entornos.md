# Matriz de entornos — Construacero Carabobo

> Última revisión documental: 2026-09-05. Solo incluye lo verificable desde el repositorio (workflows, configs, bitácora). Sin tokens ni secretos.

## Entornos

| Entorno | Propósito | Frontend | Backend | Base de datos | Deploy | Secret manager | Estado |
|---|---|---|---|---|---|---|---|
| **Producción** | Uso real del negocio | Vercel (`listo-pos-cotizaciones.vercel.app`), auto-deploy desde `main` | Cloudflare Worker (`listo-pos-cotizaciones.luigistorelogistics.workers.dev`); Vercel reescribe `/api/*` vía `vercel.json` | Supabase proyecto principal (ref `oyfyuszgjwcepjpngclv`) | Frontend: Vercel automático · Worker: GitHub Actions (`deploy-worker.yml`) y/o `wrangler deploy` manual · BD: releases SQL aplicados con runbook (backup→preflight→apply→smoke→postflight) | Cloudflare Dashboard (secrets) + GitHub Secrets + `.env`/`.env.secrets` locales (gitignored) | ✅ Activo — versión 1.0.4 |
| **Staging** | Validación de migraciones y E2E antes de promover | Vite local, puerto **5174** (directorio `construacero-staging/`) | Worker local, puerto **8789** (`wrangler dev`) | Supabase proyecto staging (ref `spupqgkdsgohxxfoxydl`) | No auto-despliega: se levanta manual (`npm run dev` del árbol staging); BD recibe migraciones numeradas (`supabase/migrations/` de staging) | `construacero-staging/.env` + `.env.secrets` (gitignored) | ✅ Activo — E2E 123/123 (2026-09-05) + suite nocturna programada |
| **Desarrollo local (principal)** | Desarrollo cotidiano contra proyecto principal o servicios locales | Vite (`npm run dev`, puerto 5173 por defecto de Vite) | Worker local (`npm run dev:worker`, puerto **8787**) | Según `.env` del repo raíz (apunta al proyecto principal) | Manual | `.env` + `.env.secrets` (gitignored), `.dev.vars` para wrangler | ✅ Activo |
| Legado camelAI | Backend de desarrollo histórico (`--dispatch-namespace chiridion`) | — | Worker en camelAI | Mismo Supabase principal | `scripts/deploy/deploy.sh` | `.dev.vars` local | ❓ Vigencia no verificable desde el repo — ver ROADMAP |

## Identificar en qué entorno estás

1. **Frontend**: URL del navegador — `vercel.app` = producción; `localhost:5174` = staging; `localhost:5173` = dev principal.
2. **Worker**: la config activa — `wrangler.toml` (raíz) apunta a producción con `SUPABASE_URL` del proyecto principal; el árbol staging tiene su propia config y `STAGING_*` en su `.env`. Los guardias del E2E **rechazan** URLs que no sean `localhost:5174/8789` (`scripts/test-e2e-staging.mjs`).
3. **Base de datos**: el `ref` del proyecto en las URLs de Supabase (`oyfy…` = principal, `spup…` = staging). Todos los scripts de release validan el ref antes de aplicar.
4. **Regla de oro de los scripts**: ningún script de apply debe ejecutarse sin su guardia de proyecto (patrón usado en `scripts/apply-release07-main.mjs`, `scripts/apply-267-staging.mjs`).

## Reglas para no confundir entornos

- **Nunca** ejecutar SQL "para ver qué pasa" contra producción; toda mutación pasa por backup → preflight → apply → smoke → rollback → postflight (`docs/runbooks/rollback-base-de-datos.md`).
- Las credenciales y refs de staging viven **solo** en `construacero-staging/`; las de producción en la raíz. No mezclar `.env`.
- Staging **no** es copia exacta de producción: puede llevar migraciones espejo con firmas ligeramente distintas (p. ej. wrappers `*_staging` de la 247) o adelantos aún no promovidos. Nunca asumir paridad: verificar (`docs/runbooks/deploy-staging.md`).
- El árbol staging (`construacero-staging/`) es un checkout espejo del código: los cambios de negocio se portan, no se copian a ciegas (los árboles divergieron en su momento: replay/idempotencia en staging, estados de comisión distintos en principal).

## Validaciones antes / después de desplegar

Antes (producción): Vitest verde · build OK · release SQL con rollback generado · backup fresco con SHA-256 · preflight read-only.
Después (producción): postflight del release · smoke de las ramas de negocio afectadas · verificación de versión de Worker (`npx wrangler deployments list`) · `vercel.app` respondiendo 200 · revisar errores en logs del Worker.

## Advertencias de arquitectura histórica

> 🗃️ Histórico: el frontend apuntó al Worker de camelAI y a workers.dev en distintas épocas; los rewrites de Vercel **no reenvían** `Authorization` (lección de INC-002). La arquitectura vigente está en `docs/decisiones/ADR-001-arquitectura-deploy.md`.
> 🗃️ Histórico: la autenticación local por PIN del proyecto base fue reemplazada por Supabase Auth + operadores por PIN/roles — ver `ARQUITECTURA.md`.
