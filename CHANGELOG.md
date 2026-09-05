# Changelog

Este archivo sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico cuando aplica. Las fechas corresponden al trabajo real registrado en `BITACORA.md`.

> Convención de este proyecto: el "release" de frontend se despliega en Vercel (auto-deploy desde `main`), el Worker en Cloudflare (GitHub Actions y/o manual) y la base de datos recibe releases SQL independientes (`supabase/release/`). Por eso cada versión agrupa los tres planos cuando aplican.

## [1.0.4] - 2026-09-05

### Added
- **Split de sábados v3.1 "designado del día"** (producción + staging): toda venta de vendedor/supervisor elegible en el día configurado genera 2 filas — dueño del cliente 1.5% + designado 0.5% — incluidas ventas a cliente propio; si el designado vende a su propio cliente cobra su 2% íntegro (guardia `v_designado_id = v_dueno_id`). Configurable en `configuracion_negocio` (`comision_split_activo`, `comision_split_pct_vendedor`, `comision_split_pct_dueno`, `comision_split_dias`); designación por fecha en tabla `comision_designacion_diaria` (endpoint `/api/comisiones/designacion` solo-jefe, upsert idempotente, rechaza externos).
- Release SQL **07** (`supabase/release/main/07_comision_split_designado_v3_review.sql` + rollbacks): columnas split, índice único `(despachoid, vendedorid)` (reemplaza `ux_comisiones_despachoid_238a`), 4 funciones (238b v4 designado, `recalcularcomisiondespacho_238b`, delegador `calcularcomisiondespacho`, ajustadores multi-fila de devolución), grants + NOTIFY.
- **Gestión integral de choferes por logística**: el rol logística puede crear/editar fichas maestras de transportistas; `CambiarTransportistaModal` rediseñado con guardado unificado.
- **Modernización de ComisionesView**: `DateRangeSelector` con cortes semanales, `ModalDetalleVendedor` modular con PDF individual (extraído a `src/components/reportes/`).
- Endpoint `/api/comisiones/lista` expone `tipo` derivado de `calculo_evidencia` (`designado` / `cliente_ajeno_dueno`).

### Changed
- **Fix TZ**: dow y fecha de designación se calculan en `America/Caracas` (el servidor vive en UTC; ventas después de 8:00 PM VE caían en otro día). Espejo staging: migraciones 266 y 267.
- **Persistencia de configuración**: el formulario envía el estado completo y el backend filtra por columnas reales (`getExistingColumns`) — el toggle split ya no se descarta en silencio.
- **Batching de 50 registros** por petición en `api/handlers/comisiones.js` (elimina `414 Request-URI Too Long` en listas grandes).
- E2E staging adaptado a v3.1 (T3 cliente propio → 2 filas; T9 guardia designado=dueño) y alineado a hora Venezuela (helper `fechaCaracas`).

### Fixed
- `recalcularcomisiondespacho_238b` **no existía en producción** pese a 4 call-sites en `despachos.js` (recálculos fallando en silencio) — instalada multi-fila.
- `ajustar_finanzas_devolucion_atomica` y `ajustar_finanzas_devolucion_neta` escalaban comisiones de **una sola fila** en devoluciones (misma clase de regresión que 262/263 en staging) — corregidas a escalado multi-fila.
- Búsqueda de clientes con header `X-Operator-Id` de respaldo (JWT sin `app_metadata.operator_id` mataba la búsqueda con 400).

### Security
- Trigger `validar_designacion_diaria` rechaza designados externos/inactivos/fuera de rol con `DESIGNADO_INVALIDO` (staging 265; endpoint y UI filtran en producción).
- RLS en `comision_designacion_diaria`: SELECT por cuenta; escritura solo vía `service_role`.
- Grants revisados: `anon`/`authenticated` sin `EXECUTE` en RPCs financieras; solo `service_role`.

### Validation
- Vitest **319/319** (principal) · build OK en ambos árboles.
- E2E staging **123/123 ×2** corridas consecutivas (pre y post-267), incluyendo T1–T9 de split con datos reales.
- Dry-run transaccional del release 07 contra Postgres real (BEGIN…ROLLBACK, 0 residuos).
- Paridad byte a byte de la 238b viva main ↔ staging (`scripts/verify-parity-238b.mjs`, 19,826 chars normalizados idénticos).
- Despacho real #2958 verificado en producción: dueño $1.50 + designado (Edgar Ramírez) $0.50.

### Migration / Deploy notes
- Producción: release 07 aplicado con toggle **OFF** y luego activado por el negocio durante el piloto del sábado 05/09; deploy Worker+Frontend versión `9ff2a3d4` (y anteriores `983b7a10`).
- Staging: migraciones 265 (trigger no-externo), 266 (TZ), 267 (regla v3.1).
- Rollback en 3 escalones documentado en `docs/runbooks/2026-09-05-runbook-split-sabados-principal.md`.

### Known follow-ups
- Ninguno bloqueante del release; ver `ROADMAP.md` para pendientes activos.

## [1.0.3] - 2026-09-05

### Added
- **Reversión consciente de devoluciones (release 06)**: `revertir_entrega_finanzas_atomica` reemplazada in-place (misma firma de 5 args) — anula atómicamente abonos `Devolución`/`Saldo a favor` sin exigir borrado manual; errores `REEMBOLSO_EFECTIVO_REGISTRADO` y `CREDITO_YA_CONSUMIDO` atómicos; respuesta con `abonos_devolucion_anulados` / `credito_anulado_usd`.
- UX de reversión: panel "Despacho totalmente devuelto", confirmación inteligente en `DevolverAnularModal` (consulta CxC en vivo) y toast con efecto exacto.
- Test `despachosReversionDevoluciones.test.js` (abono devolución → reversión RPC pura; cobro real → 400).

### Changed
- Guardarraíl de `/api/despachos/estado` alineado: los ajustes contables de devolución ya no bloquean reversión (solo cobros reales).

### Fixed
- Activación/desactivación de operadores (restricción RLS) vía endpoint backend con `service_role` y feedback UI.

### Security
- Smoke F4 confirmó: `anon`/`authenticated` sin `EXECUTE` en la RPC de reversión; `service_role` con EXECUTE.

### Validation
- Ciclo completo F0–F5 en producción: backup (`tmp/kardex-principal-pre-release06-2026-09-05T04-04-19-108Z.dump`, SHA-256 `62768b0d…76aa2c`) → preflight PASS → apply → smoke con ROLLBACK (0 residuos, 3 ramas) → postflight PASS → Vercel Ready (`https://listo-pos-cotizaciones.vercel.app` 200).
- Vitest 319/319 · build OK.

### Migration / Deploy notes
- Release SQL: `supabase/release/principal/06_reversion_con_devoluciones.sql` (+ rollback). Espejo staging: `264_staging_reversion_con_devoluciones.sql` (+ rollback) — **aplicación del espejo y su E2E quedaron pendientes**; ver `ROADMAP.md`.

### Known follow-ups
- Aplicar espejo 264 en staging y correr E2E de devolución/reversión.

## [1.0.2] - 2026-09-03

### Added
- **Reembolso multi-método** en devoluciones parciales (Efectivo, Zelle, Transferencia, Pago Móvil) con liquidación mixta saldo/reembolso y trazabilidad en caja y reportes.

### Migration / Deploy notes
- RPC atómica de devolución con parámetros de reembolso e idempotencia (16 args).

## [1.0.1] - 2026-09-03

### Added
- **Destino de saldo en devoluciones**: elección entre Saldo a Favor y Reembolso, con consumo de crédito CxC (`consumo_credito`) coherente.

## [1.0.0] - 2026-08-28/29

### Added
- Promoción del paquete de guardrails de Kardex al principal (releases SQL 01–06a) y deploy Worker+frontend con productos/Kardex vía Worker.
- Comisión 238b (guardrails, evidencia JSONB) y 238a (contrato neutral) aplicadas a producción.
- Corrección de tasas oficiales BCV USD/EUR.

### Fixed
- Cobro de la diferencia en devolución parcial (despliegue a producción 28/08).
- Error recurrente de enum `log_origen` en el cron del Worker (migración 203; fix definitivo = deploy del Worker actualizado).

### Security
- `06_security_grants_review.sql` / `06a_security_grants_safe.sql`: grants de seguridad aplicados al principal con subconjunto seguro verificado.

[Unreleased]: ver `ROADMAP.md` para pendientes activos y `BITACORA.md` para el detalle diario.
