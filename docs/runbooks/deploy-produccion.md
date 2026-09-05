# Runbook — Deploy a producción

> Producción es la URL que usan los usuarios finales. Basado en el flujo real del repo (`.github/workflows/deploy-worker.yml`, `vercel.json`) y la bitácora. Sin secretos ni comandos destructivos.

## Propósito

Desplegar frontend y Worker a producción con validación en cada capa, sin romper el servicio ni los datos.

## Precondiciones

- [ ] Los cambios pasaron por staging con su E2E en verde (ver `deploy-staging.md`).
- [ ] Si hay cambios de BD: release SQL promovido según `promocion-release.md` y aplicado **antes** del código que lo usa.
- [ ] `git status` limpio en `main`; el commit a desplegar etiquetado/identificado en la bitácora.
- [ ] Secrets intactos: el workflow valida con `test -n` fail-fast (`CF_API_TOKEN`, `CF_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `DEV_SUPER_CODE`). Ver `ADR-003-gestion-de-secretos.md`.

## Qué rama se despliega

- Solo `main`. Frontend: Vercel auto-deploy. Worker: GitHub Actions (`deploy-worker.yml`).

## Flujo de CI/CD

1. `git push origin main` dispara:
   - **Vercel**: build del frontend (`npm run build` con `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` desde secrets) y publicación.
   - **GitHub Actions** (`deploy-worker.yml`): instala dependencias, build del frontend, configura secrets del Worker con `wrangler secret put` y ejecuta `wrangler deploy`.
2. Nada se despliega manualmente (lección de INC-002).

## Checklist previo

- [ ] Tests locales: Vitest en verde y build sin errores (warning conocido: chunks > 500 kB).
- [ ] `vercel.json` sigue apuntando `/api/*` al Worker primario (`luigistorelogistics.workers.dev`) — nunca a camelAI (INC-003/500).
- [ ] `wrangler.jsonc` sin placeholders vacíos (regla ADR-003).

## Pasos de deploy

1. Push a `main`.
2. Verificar en GitHub Actions que el job terminó en verde.
3. Verificar en Vercel que el deployment nuevo está "Ready" y sirve el bundle esperado.

## Smoke tests posteriores

- [ ] App carga (`GET` del dominio → 200).
- [ ] `GET /api/ping` → 200.
- [ ] Una ruta autenticada sin sesión → **401** "No autenticado" (no 404, no 500). Esto prueba que la ruta existe y el guard está activo.
- [ ] Login de un operador real → 200; carga de un módulo que use el Worker (ej: Clientes, historial de INC-002).

## Validación por capa

- **Frontend**: bundle nuevo servido (verificar hash del asset en el HTML si hay duda).
- **Worker**: versión desplegada anotada en la bitácora; rutas nuevas responden 401/200 según auth.
- **Base de datos**: si el release incluía SQL, ejecutar el postflight del paquete y confirmar objetos/toggles esperados.

## Rollback de aplicación

- **Frontend**: en Vercel, "Instant Rollback" al deployment anterior (menú del deployment).
- **Worker**: `npx wrangler rollback` (lista versiones con `npx wrangler deployments list`) o re-deploy del commit anterior.
- **Base de datos**: NO improvisar — seguir `rollback-base-de-datos.md`.
- Tras el rollback, repetir los smoke tests.

## Errores conocidos

- Warning de build por chunks > 500 kB: esperado, no bloquea.
- Service Worker cacheado en clientes puede servir `index.html` viejo tras un deploy (INC-001): mitigación manual documentada; prevención pendiente en roadmap.
- Si el smoke da 500 en rutas admin: revisar secrets del Worker (patrón INC-003, endpoint de diagnóstico de longitudes).
