# INC-003: Variables vacías de `wrangler.jsonc` sobrescribieron secretos del Worker (errores 500)

- Fecha: 26/04/2026 (detectado durante la auditoría de seguridad)
- Estado: ✅ Resuelto — reglas formalizadas en `docs/decisiones/ADR-003-gestion-de-secretos.md`
- Severidad: Crítica (producción con secrets destruidos)
- Impacto: Operaciones administrativas del Worker de producción caídas (PIN de super admin devolvía 500 desde Vercel); el entorno camelAI funcionaba porque su deploy inyectaba valores reales.

## Síntoma

- Desde Vercel, el PIN devolvía **500** (no 401) en rutas administrativas.
- Endpoint de diagnóstico temporal (`/api/dev/check-secrets`) reportó:

```
Producción:  SUPABASE_SERVICE_KEY_len: 0   ← vacío (destruido)
camelAI:     SUPABASE_SERVICE_KEY_len: 219 ← correcto
```

## Causa raíz

`wrangler.jsonc` contenía placeholders vacíos (ej. `"SUPABASE_SERVICE_KEY": ""`). En el deploy de Wrangler, una **variable vacía definida en el jsonc sobrescribe el secret del Dashboard**, destruyendo el valor configurado. Los deploys anteriores habían borrado 5 secrets: `GROQ_KEYS_A/B/C`, `SUPABASE_SERVICE_KEY` y `VAPID_PRIVATE_KEY`.

Por qué funcionaba en camelAI: `deploy.sh` inyectaba los valores reales desde `.dev.vars` antes del deploy.

## Mitigación inmediata

1. Re-ingreso manual de los 5 secrets en el Cloudflare Dashboard.
2. Verificación con el endpoint de diagnóstico: todas las longitudes correctas.

## Corrección permanente

1. **`wrangler.jsonc`:** eliminados los 5 placeholders vacíos; solo quedan vars públicas (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY`).
2. **`deploy.sh`:** reescrito para **agregar** las vars secretas al jsonc dinámicamente en deploy (nunca reemplazar con strings vacíos).
3. **GitHub Actions** (`deploy-worker.yml`): paso de inyección de secrets desde GitHub Secrets antes de `wrangler deploy` (posteriormente evolucionado a `wrangler secret put`).
4. **Regla estructural:** los secrets viven en Cloudflare Dashboard (runtime), GitHub Secrets (CI/CD) y `.dev.vars` local (solo desarrollo camelAI) — jamás en el repositorio.

## Prevención

- **Regla 1:** nunca poner `"SECRET_KEY": ""` en `wrangler.jsonc` — las vars vacías sobrescriben secrets del Dashboard.
- **Regla 2:** todo secret nuevo se agrega en Cloudflare Dashboard, no en el jsonc (los valores del jsonc quedan expuestos en el repo).
- **Regla 3:** tras cualquier cambio de estrategia de secrets, verificar con un endpoint de diagnóstico de longitudes (sin imprimir valores).
- Nota histórica: `DEV_SUPER_CODE` llegó a estar en `vars` del jsonc como temporal; debía tratarse siempre como secret (`<NO_DOCUMENTAR_VALOR_REAL>`).

## Validación

- Endpoint de diagnóstico reportó longitudes correctas para los 5 secrets restaurados (bitácora, auditoría 26/04/2026).
- Super PIN validado en servidor (frontend ya no compara PIN localmente).

## Referencias

- `BITACORA.md` — auditoría de seguridad (26/04/2026).
- `docs/decisiones/ADR-003-gestion-de-secretos.md`.
- `docs/runbooks/deploy-produccion.md`.
