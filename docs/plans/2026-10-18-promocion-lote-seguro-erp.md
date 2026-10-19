# Plan — Promoción del lote seguro ERP → Producción (reportes + pruebas + documentación)

> **Fecha:** 2026-10-18 · **Estado:** PROPUESTO (listo para ejecutar)
> **Fuente:** [dif-erp-vs-produccion-20261018.md](../operaciones/dif-erp-vs-produccion-20261018.md) §1, §3, §4 (grupos "listo para traer sin riesgo")
> **Principio:** un solo commit atómico y revertible. Nada del grupo "revisar caso a caso", ni F3/16, ni secretos. El checkout ERP es **solo lectura**.

## Alcance

| INCLUYE | NO INCLUYE |
|---|---|
| 1. Feature de reportes Crédito/CxC (3 archivos) | Los otros 21 archivos del grupo "revisar caso a caso" (§5 del informe) |
| 2. Pruebas automáticas solo-en-ERP (~22) + módulo puro + fixtures | Releases SQL 15 (F3) y 16 (delegador) + migraciones staging 277–282 |
| 3. Documentación (~55: runbooks, history, planes, nómina) | Harness F3 `test-f3-comision-local-integration.mjs` |
| | ~60 scripts históricos apply/audit y scripts staging `validate-*` (decisión aparte) |
| | `.github/SECRETS_PRODUCCION_COPIAR_PEGAR.md` y `construacero-staging/.dev.vars` — **nunca**; además rotar esas credenciales |
| | Ruido: `tmp/`, `scratch/`, `outputs/`, 344 PDFs, 298 archivos que difieren solo en EOL |

## Hechos verificados (2026-10-18 — no re-derivados)

1. Producción **no tiene commits propios** sobre `src/views/ReportesView.jsx` ni `src/components/reportes/DateRangeSelector.jsx` desde el ancestro común `80ae891` → copiar las versiones del ERP es un **fast-forward**: nada del trabajo de producción se pierde.
2. El worktree del ERP tiene **+16/−5 sin commitear** sobre el commit `980129c` en `ReportesView.jsx` (bloque "Cuadre de movimientos" / abonos sin clasificar). Se promueve la versión **worktree**; ese delta ya se revisó línea por línea al redactar este plan y pertenece al mismo feature.
3. Las dependencias del feature ya existen en producción: `getUltimoSabadoRange`, `getLocalISODate` y resto de `src/utils/dateHelpers.js`, y `useResumenCxC` en `src/hooks/useCuentasCobrar.js` (misma firma).
4. `src/utils/cxcPeriodReport.js` es un **módulo puro sin imports** que produce `kpis.*` y `revisionesSaldoActual` → no depende del backend ni de hooks divergentes.
5. Runner de tests de producción: **vitest 4** (`npm test` → `vitest run`), ya instalado y configurado.
6. Los tests `scripts/lib/__tests__/*Migration.test.js` leen **archivos SQL vía `fs`** → solo entran los que apunten a SQL ya presente en producción (ver regla de cuarentena en Tarea 2).

## Tareas

### Tarea 0 — Manifiesto y staging de copia
1. Copiar los archivos candidatos desde el ERP (solo lectura) a un directorio de staging local (`tmp/promocion-lote-seguro/`), con lista explícita y SHA-256 por archivo.
2. Verificar contra la lista de exclusión: ningún archivo de secretos, ningún `tmp/`/`scratch/`/PDF, ningún `.dev.vars`.
3. Normalizar finales de línea a **LF** al copiar (convención de `.gitattributes`), para que el diff del commit sea revisable y no mezcle el ruido EOL del commit `b539e0d`.
4. **Whitelist en `.gitignore` (obligatorio):** el repo ignora por defecto `*.md`, `*.test.js`, `__tests__/` y `*.mjs` y solo trackea lo listado en negaciones `!`. Añadir al commit las negaciones para **cada archivo nuevo** del lote (plan, tests, fixtures); sin ellas git los ignora silenciosamente y el commit sale incompleto.

### Tarea 1 — Feature de reportes Crédito/CxC (3 archivos)
| Archivo | Acción |
|---|---|
| `src/utils/cxcPeriodReport.js` | **Nuevo** — copiar tal cual |
| `src/components/reportes/DateRangeSelector.jsx` | Sobrescribir con versión ERP (fast-forward verificado, hecho 1) |
| `src/views/ReportesView.jsx` | Sobrescribir con versión worktree ERP (fast-forward + delta de 16 líneas del hecho 2) |

No se toca ningún otro archivo de la lista de 23 divergentes — en particular **no** se copia `src/hooks/useCuentasCobrar.js` ni `src/services/pdf/cxcPDF.js` (producción va adelante ahí con el guard `Idempotency-Key` del release 14).

### Tarea 2 — Pruebas automáticas (~22 + fixtures)
Candidatos (solo-en-ERP según §4 del informe):
- `api/handlers/__tests__/` (7): `_harness.js`, `clientesPrestamoAtomic.test.js`, `clientesReasignacion.test.js`, `despachosAtomic.test.js`, `inventarioAtomic.test.js`, `origenMutaciones.test.js`, `transportistasAtomic.test.js`
- `api/lib/__tests__/` (2): `isSameOriginRequest.test.js`, `transportistaUtils.test.js`
- `src/utils/__tests__/` (10): `adminClientAuth.test.js`, `cxcPeriodReport.test.js`, `devolucionReembolso.test.js`, `pdfCodigosDeterminista.test.js`, `reporteDescuentos.test.js`, `smartSearchStrict.test.js`, `testerClientContract.test.js`, `testerDispatchContract.test.js`, `transportistaColors.test.js`, `transportistaSchema.test.js`
- `scripts/lib/__tests__/` (3): `codMigration.test.js`, `comisionNetaBucketMigration.test.js`, `resumenFinancieroMigration.test.js`
- Módulo asociado: `src/utils/cxcPeriodReport.js` (ya en Tarea 1) · Fixtures: `scripts/fixtures/cod-modal/` (5 archivos)

**Regla de cuarentena (obligatoria):** un test entra al commit solo si (a) todos sus imports resuelven contra archivos ya presentes en producción o incluidos en este lote, y (b) pasa suelto (`npx vitest run <archivo>`). Los que apunten a módulos o SQL solo-en-ERP (típicamente los de F3/16 o comportamiento de los handlers divergentes) se **diferirán con lista explícita** para promoverlos con su release. **No se debilitan aserciones, no se salta nada, no se agregan supresiones.**

### Tarea 3 — Documentación (~55 archivos)
- **Runbooks (9)**: `paquete-release-f3-main.md`, `ventana-apply-f3-main.md`, `validacion-f3-staging.md`, `paquete-revision-contable-f3.md`, `conciliacion-comparador-f3-general.md`, `paquete-firmas-r14-main.md`, `guia-dia-del-cambio.md`, `preparacion-implementacion-principal.md`, `analisis-delegador-public.md`. Se promueven **solo como documentación** aunque describan F3/16: los releases mismos no se promueven.
- **`docs/history/`** (~26 archivos solo-en-ERP de los 28 del ERP).
- **`docs/plans/` ago–sep (~15)** incluidos los de nómina: `PLAN_NOMINA.md`, `PLAN_PERSONAL_NOMINA.md`, `2026-08-08-nomina-fases-inteligentes.md`, `2026-08-08-nomina-venezuela-logistica-free-tier.md`.
- **Nómina suelta**: `docs/requirements/nomina-matriz-cumplimiento.md`, `docs/operations/nomina-release-checklist.md`.
- Criterio: entran archivos que producción **no tiene**. Si un doc existe en ambos lados con contenido distinto (p.ej. `BITACORA.md`), se lista para revisión trivial en vez de sobrescribir.

### Tarea 4 — Gates de verificación (en orden, sin omitir)
| Gate | Comando / acción | Criterio de paso |
|---|---|---|
| G1 Manifiesto | conteo + SHA-256 de lo copiado vs manifiesto Tarea 0 | coincidencia exacta |
| G2 Tests | `npm test` (vitest run, suite completa) | suite verde con exit status real preservado (sin pipes que oculten el código de salida) |
| G3 Build | `npx vite build` | build de producción verde (atrapa imports rotos del feature) |
| G4 Smoke | Pantalla Reportes → pestaña Crédito/CxC: navegación, rangos de fecha (día/semana/corte/mes), KPIs, bloque "Cuadre de movimientos" | renderiza con datos reales; sin errores en consola |
| G5 Secretos | escaneo del diff completo del commit | 0 JWTs, 0 claves, sin `.dev.vars` ni `SECRETS_*` |

### Tarea 5 — Commit atómico único
Código + tests + documentación en **un** commit revertible, con mensaje que referencie este plan y el informe de diferencias. Sin despliegue: el Worker no cambia; el deploy del frontend queda como paso posterior explícito fuera de este plan.

## Rollback
`git revert <commit>` — un solo commit; no toca esquema, RPCs ni Worker, así que el rollback es puramente de repositorio. Si un gate falla por un archivo del lote, se retira **ese archivo** del commit y se registra como diferido (nunca parcheando el test ni el gate para que pase).

## Riesgos y contingencias
1. **Tests atados a archivos divergentes** (p.ej. `despachosAtomic` contra `api/handlers/despachos.js` que tiene +81/−10 sin commit en el ERP): los atrapa la regla de cuarentena → se diferirán, no se copian handlers para satisfacerlos.
2. **KPIs vacíos en el tab Crédito** si `useResumenCxC`/backend de producción no entrega los campos crudos que `cxcPeriodReport.js` consume (el hook divergente del ERP sí los procesa): contingencia = extraer el procesamiento mínimo a un módulo nuevo **sin tocar** `useCuentasCobrar.js`; si aún no calza, diferir el tab con lista explícita y dejar nota en la bitácora.
3. **Ruido EOL** (298 archivos normalizados por `b539e0d`): se neutraliza copiando en LF (Tarea 0.3); cualquier diff que muestre solo cambios de línea se descarta.
4. **Exposición de credenciales** fuera de alcance pero urgente: rotar lo que contenga `.github/SECRETS_PRODUCCION_COPIAR_PEGAR.md` y `.dev.vars` del ERP, se promueva o no.
