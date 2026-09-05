# Roadmap — Pendientes vigentes, deuda técnica y mejoras

> Estado al 2026-09-05. Cada entrada fue verificada contra `BITACORA.md`, `CHANGELOG.md`, migraciones, workflows y código. Los "pendientes para siguiente sesión" históricos **no** se heredan automáticamente: si una sesión posterior los cerró, figuran como resueltos o no aparecen. El roadmap histórico de fases de producto (abril 2026, todo completado) vive en `docs/history/2026-04-25-roadmap-fases-producto.md`.

Convenciones: **P0** riesgo productivo/financiero/seguridad · **P1** impacto operativo importante · **P2** mejora relevante · **P3** idea futura. Estados: 🔄 activo · ⚠️ requiere verificación · ✅ resuelto · 🗃️ descartado/histórico.

## 1. Pendientes activos

| Prioridad | Área | Tarea | Motivo/impacto | Estado | Evidencia o referencia |
|---|---|---|---|---|---|
| P1 | Frontend/PWA | Prevención definitiva del cache de `index.html` por Service Worker (estrategia recomendada: no cachear HTML en el SW, solo assets con hash) | Cada deploy con chunks renombrados rompe la app para usuarios con SW viejo; mitigación actual es manual por dispositivo | 🔄 | `docs/incidentes/INC-001-service-worker-cache-y-chunks.md`; sesión 15 de `BITACORA.md` |
| P1 | Calidad | E2E de reversión con devoluciones previas en staging (release 06 / 264): confirmar que la suite cubre asserts específicos de reversión con devoluciones y CxC mixta | El espejo 264 está aplicado, pero el CHANGELOG 1.0.3 dejaba el seguimiento abierto y no hay evidencia de asserts dedicados | ⚠️ | `CHANGELOG.md` 1.0.3 Known follow-ups; `construacero-staging/scripts/test-e2e-staging.mjs` (21 menciones devolución/reversión, cobertura específica sin verificar) |
| P1 | Documentación | Restaurar o remover la referencia al plan `docs/plans/2026-09-04-plan-comision-split-designado-sabados-v3.md` (el archivo no está en el repo) | El runbook del split lo cita como plan base | 🔄 | Anotado en `docs/runbooks/2026-09-05-runbook-split-sabados-principal.md` |

## 2. Deuda técnica

| Prioridad | Área | Tarea | Motivo/impacto | Estado | Evidencia o referencia |
|---|---|---|---|---|---|
| P2 | Infra | Eliminar Workers duplicados en Cloudflare (`construacerocarabobo`; evaluar el dispatch namespace camelAI `chiridion`) | Riesgo de desplegar/apuntar al Worker equivocado (histórico INC-002/INC-003) | 🔄 | Auditoría 26/04/2026 en `BITACORA.md`; `docs/decisiones/ADR-001-arquitectura-deploy.md` |
| P2 | CI/CD | Automatizar smoke tests post-deploy en el workflow (ping + ruta auth 401 + app 200) y alertar en fallo | Hoy el smoke depende del checklist manual de `docs/runbooks/deploy-produccion.md` | 🔄 | `.github/workflows/deploy-worker.yml` (sin paso smoke); patrón manual ya definido |
| P2 | Calidad | Matriz de paridad principal↔staging automatizada y programada (extender `scripts/verify-parity-238b.mjs` a las funciones críticas completas) | La paridad hoy se verifica ad-hoc por función; la lección 262→263 exige cobertura de cadenas completas | 🔄 | `docs/operaciones/matriz-migraciones.md`; `docs/runbooks/deploy-staging.md` |
| P2 | Limpieza | Ejecutar la auditoría de cadenas de funciones (`audit-function-chains.mjs` existe en staging) también contra el principal tras cada release | Previene la clase de bug 262→263 (un `CREATE OR REPLACE` pisa fixes previos) | 🔄 | `docs/decisiones/ADR-004-finanzas-devoluciones-y-reembolsos.md`; matriz de migraciones |
| P3 | Build | Reducir chunks > 500 kB (code-splitting fino de vistas pesadas) | Solo warning de build; sin impacto funcional conocido | 🔄 | Logs de build en `BITACORA.md` (warning persistente) |

## 3. Mejoras futuras

| Prioridad | Área | Tarea | Motivo/impacto | Estado | Evidencia o referencia |
|---|---|---|---|---|---|
| P3 | Comisiones | Ajuste fino del reparto cuando el designado vende a cliente ajeno (hoy 1.5% dueño + 0.5% designado; el negocio podría querer que el vendedor que cierra conserve más) | Decisión de negocio, no bug; cambio de una línea en la 238b | 🔄 | Conversación del piloto 05/09/2026; `docs/runbooks/2026-09-05-runbook-split-sabados-principal.md` |
| P3 | Operación | Panel de monitoreo del día de piloto split (comisiones designado en vivo, conciliación al cierre) | Hoy la conciliación es manual vía reportes | 🔄 | Runbook split, Fase 4 piloto |
| P3 | Docs | Exportar la documentación a PDF para reparto (existen `docs/generar_manual.py` / `md_to_pdf.py`) | Onboarding de personal nuevo | 🗃️ Idea existente sin priorizar | `docs/generar_manual.py` |

## 4. Históricos resueltos o descartados (verificados)

| Elemento histórico | Resultado verificado | Evidencia |
|---|---|---|
| Fases 1–4 del roadmap de producto (referencia de pago, rol logística, dashboards, venta rápida) | ✅ Todas completadas (abril 2026) | `docs/history/2026-04-25-roadmap-fases-producto.md` |
| `DEV_SUPER_CODE` temporal en `vars` de wrangler | ✅ Cerrado: el `wrangler.toml` actual solo define `SUPABASE_URL` y documenta que los secrets van fuera del archivo | `wrangler.toml` líneas 18–26; `docs/decisiones/ADR-003-gestion-de-secretos.md` |
| Fix del bucle multi-fila 262→263 (split pisado por devoluciones) | ✅ Corregido en staging (263) y en el principal (release 07 + recálculo real #2958) | `CHANGELOG.md` 1.0.4; matriz de migraciones |
| TZ Caracas para el cálculo de sábados | ✅ Aplicado en ambos entornos (266 + parche vivo en principal) | `CHANGELOG.md` 1.0.4 Changed |
| Toggle `comision_split_activo` sin persistir (frontend) | ✅ Corregido y desplegado (versión `9ff2a3d4`) | `CHANGELOG.md` 1.0.4; sesión 05/09/2026 |
| Espejo 264 en staging | ✅ Aplicado (la migración existe y la sesión 05/09/2026 registró la reversión consciente); queda el ⚠️ de asserts E2E específicos (fila arriba) | `docs/operaciones/matriz-migraciones.md` |
| X-Operator-Id de respaldo en búsqueda de clientes | ✅ Corregido (commit `1eec4ae`) | `CHANGELOG.md` 1.0.4 Fixed |
