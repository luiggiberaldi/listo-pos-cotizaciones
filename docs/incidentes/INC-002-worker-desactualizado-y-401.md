# INC-002: Worker desactualizado en `workers.dev` que generaba errores 401

- Fecha: 24/04/2026
- Estado: ✅ Resuelto (arquitectura de deploy automatizada; decisión vigente en `docs/decisiones/ADR-001-arquitectura-deploy.md`)
- Severidad: Alta (módulo Clientes inoperativo en producción)
- Impacto: La página de Clientes no cargaba desde Vercel; otras vistas no afectadas (usan Supabase directo, sin Worker).

## Síntoma

```
GET https://listo-pos-cotizaciones.vercel.app/api/clientes? 401 (Unauthorized)
```

Repetido 4 veces (React Query reintenta 3 veces). La página mostraba "Error al cargar los clientes".

## Línea de tiempo del diagnóstico

1. **Hipótesis: token expirado** → se creó `src/services/authFetch.js` con retry automático de refresco. No resolvió.
2. **Hipótesis: Vercel elimina el header `Authorization` en rewrites** → se migró a llamadas cross-origin directas con `VITE_WORKER_ORIGIN`. El 401 persistió.
3. **Prueba cruzada en camelai.app** → el mismo código funcionaba sin errores. Confirmó que el problema no era el frontend ni el token.
4. **Endpoint temporal `/api/debug-auth`** → credenciales correctas en ambos Workers; el token que enviaba el frontend desde Vercel era rechazado.
5. **Causa raíz:** el Worker desplegado en `luigistorelogistics.workers.dev` estaba **desactualizado** — el deploy era manual (`wrangler deploy`) y no se había re-desplegado tras cambios de código de autenticación.

## Mitigación inmediata

- Redespliegue manual del Worker con el código vigente.

## Corrección permanente

1. **CI/CD:** `.github/workflows/deploy-worker.yml` despliega automáticamente el Worker a `workers.dev` en cada push a `main` (con secrets `CF_API_TOKEN` / `CF_ACCOUNT_ID`).
2. **Vercel** auto-despliega el frontend en cada push a `main`; `vercel.json` hace proxy de `/api/*` al Worker primario.
3. `src/services/authFetch.js` se conservó como capa de resiliencia (retry con refresco de token en 401).

## Prevención

- Nunca deploys manuales del Worker de producción: solo vía GitHub Actions.
- Tras cada deploy, smoke de una ruta autenticada (esperar 401 sin sesión, 200 con sesión — no 404/500). Este smoke quedó incorporado a los runbooks de deploy.
- Lección relacionada documentada: los rewrites de Vercel no reenvían `Authorization` a URLs externas; para endpoints autenticados usar llamadas directas con CORS o proxy del mismo dominio.

## Validación

- Módulo Clientes cargando desde `vercel.app` tras el redeploy (bitácora, sesión 10 del 24/04/2026).

## Referencias

- `BITACORA.md` — sesión 10 (24/04/2026).
- `docs/decisiones/ADR-001-arquitectura-deploy.md`.
- `docs/runbooks/deploy-produccion.md`.
