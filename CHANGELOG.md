# Changelog

Este archivo sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico cuando aplica. Las fechas corresponden al trabajo real registrado en `BITACORA.md`.

> Convención de este proyecto: el "release" de frontend se despliega en Vercel (auto-deploy desde `main`), el Worker en Cloudflare (GitHub Actions y/o manual) y la base de datos recibe releases SQL independientes (`supabase/release/`). Por eso cada versión agrupa los tres planos cuando aplican.

## [Unreleased]

### Fixed

- **COD incobrable por consumo de saldo a favor mal tipado en la entrega (caso #3072, staging 274)**: la rama 'Saldo a favor' de las RPCs de entrega insertaba `tipo='abono'` (pago de deuda) en vez de `consumo_credito` y decrementaba el saldo de deuda — neteaba el cargo COD y lo dejaba incobrable (cliente con "Sin deuda" pero COD impago; `/api/cxc/abono` lo rechazaba con 400). Fix: tipo correcto + `saldo_usd` desde el bolsillo de favor (replay canónico del ledger) en `confirmar_entrega_finanzas_atomica_staging` e `confirmar_entrega_finanzas_idempotente` (guard 273 intacto). Worker edición profunda alineado en main (staging ya estaba corregido). Arnés propio 28/28 (incluye cobrabilidad del COD post-entrega e idempotencia); E2E 123/123; arnés 272 22/22. Reparación: 13 filas históricas retipadas en staging con auditoría previa por despacho (los que pagaron deuda real de un crédito se conservan como `abono`), 0 clientes inconsistentes. El principal mantiene el gap hasta su release 13 (con reparación de #3072).
- **Saldo a favor fantasma en producción (release 12, cierre del caso Antoplast $112 y ROSA SANCHEZ $4.14)**: espejo exacto de las migraciones 272/273 de staging aplicado al principal — fórmula de `saldo_a_favor` con `consumo_credito` en las 4 RPCs vivas (`confirmar_entrega_finanzas_idempotente`, `ajustar_finanzas_devolucion_atomica`, `ajustar_finanzas_devolucion_neta`, `registrar_cobro_diferencia_devolucion`) + guard anti-duplicado 273 en la entrega. Método release 07–11: dump vivo → builder con parche quirúrgico → verificador LCS (4/4 exacto) → dry-run transaccional en staging con paridad del parche → preflight de intactidad → apply con postflight interno → postflight independiente byte-idéntico 4/4 → reparación canónica con guarda `RETURNING`==2 (Antoplast $112→0, ROSA $4.14→0; replay global: 0 inconsistentes en los 867 clientes) → smoke read-only 9/9 sobre DES-2896/2697 (CxC, comisiones y COD intactos). Rollback en `12_rollback_review.sql` (cuerpos originales del dump). Nota: los cuerpos de las RPCs de devolución difieren entre entornos por features (reembolsos multi-método del principal); la paridad validada es del parche, no del cuerpo completo.
- **Saldo a favor fantasma tras entregar (causa raíz del caso Antoplast $112)**: las RPCs de entrega/devolución recalculaban `clientes.saldo_a_favor` con una fórmula que no conocía el tipo `consumo_credito` (introducido 2026-08-28) y pisaban el valor correcto del trigger tras cada entrega — doble escritor de un invariante (misma clase que 262-vs-257). Staging: migración `272` (5 funciones parcheadas, rollback incluido). Además, el guard anti-duplicado de la entrega solo revisaba `tipo='abono'` e insertaba un abono repetido cuando el Worker ya había registrado el consumo en la aprobación — migración `273` (guard `IN ('abono','consumo_credito')`). Arnés propio `test-saldo-favor-272.mjs` 22/22 (incluye la aserción que faltaba: columna=0 tras entregar un mixto) + E2E 123/123. Auditoría de staging: 0 clientes inconsistentes. El principal conserva el mismo gap en `confirmar_entrega_finanzas_idempotente` — release 12 pendiente con reparación de Antoplast ($112) y ROSA SANCHEZ ($4.14).
- **Agujero COD/split cerrado en la ruta de entrega**: la RPC `confirmar_entrega_finanzas_idempotente` llama a `calcularcomisiondespacho`, que en el principal seguía siendo el calculador legacy (sin tranca COD ni split de sábados) — una entrega con COD impago generaba comisión (detectado en DES-02975, $2.00). **Release 10**: reemplazo por el delegador a `calcularcomisiondespacho_238b` (paridad con staging desde la migración 257). Dry-run transaccional en staging → apply → postflight 100% verde → prueba de fuego en vivo sobre #2975 (delegador devuelve NULL, cero filas). Fila bogus de #2975 eliminada con guardas (pendiente, $0 pagados). Rollback disponible en `10_rollback_review.sql` (cuerpo legacy preservado).

### Added
- **Auditor nocturno de saldos del principal** (`scripts/auditor-saldos-main.mjs` + workflow `auditor-saldos-main.yml`): replay canónico del ledger vs columnas `saldo_pendiente`/`saldo_a_favor` de TODOS los clientes, solo lectura (cero riesgo productivo), con guardia de proyecto (se niega a correr contra otro ref), reporte por cliente con deltas y `exit 1` si hay divergencia (correo de GitHub + webhook opcional `MAIN_ALERT_WEBHOOK`). Cron 02:00 VE diaria + `workflow_dispatch` manual; sin dependencias npm (~1 min de CI). La reparación NO es automática: el reporte alimenta al script de reparación con guardas del release 12. Primera corrida en vivo: ✅ 0 divergentes en 867 clientes (1.4s). Requiere secretos `MAIN_SUPABASE_ACCESS_TOKEN` (y opcional `MAIN_ALERT_WEBHOOK`).
- **Tranca COD v4 (comisión solo cuando el COD está pagado, todo-o-nada)**: despacho con porción "Cobro a destino" (monto > 0) y `cobro_destino_pagado ≠ true` genera CERO comisión — tampoco la parte de adelanto en pagos mixtos. Al conciliar el COD, la comisión nace completa por el total (disparador en `editar-pago` cuando el flag pasa a pagado con despacho aprobado/entregado). Toggle por cuenta `comision_cod_solo_pagado` (default OFF; activado 13/13 en producción tras postflight). Staging: migración `270` + helper `comision_238b_cod_pendiente` (formatos legacy incluidos); principal: release `09` (rollback byte-idéntico al cuerpo previo). Arnés propio 30/30; split de sábados hereda la tranca (el designado se resuelve por fecha de creación en hora VE). Comisiones ya pagadas intocables (G3). Sin efecto retroactivo: 2 despachos COD previos con comisión ($270.88) quedan para revisión manual.
- Control de stock al aprobar despachos, **modo solo advertencia (v2, nunca bloquea)**: RPC `aprobar_despacho_inventario_atomico` calcula disponible = físico − comprometido (por otros despachos aprobados, con locks FOR UPDATE) y fija el estado en la misma transacción, pero **no rechaza por faltante**: devuelve `faltantes` en la respuesta y la aprobación sigue su curso. Nuevo modo `p_solo_validar` (solo lectura: análisis sin tocar el despacho). Toggle `bloqueo_stock_aprobacion` por cuenta — en ON el faltante se registra en auditoría; en OFF silencioso. Venta Anticipada respetada; items externos/préstamos excluidos. Stock comprometido visible de nuevo en UI (`useStockComprometido` reactivado); cálculo de faltantes en UI alineado a disponible. Staging: migraciones `268` + `269`; principal: releases `08` + `08b` (cuerpos idénticos, verificados).

### Validation
- Arnés tranca COD 30/30 (T0–T10: retrocompatibilidad, todo-o-nada, conciliación, split sábado, G3, idempotencia); E2E staging 123/123; dry-run transaccional release 09 en staging; postflight 09: tranca viva, split intacto, helper 7/7, toggle 0/13→13/13, hash de entrega intacto (`ef0ef730`).
- Arnés RPC v2 20/20 (T2/T3 ahora aprueban informando faltantes); suites 324/324 (principal) y 265/265 (staging); E2E staging 123/123; postflight 08b principal 100% verde; verificación read-only en producción sobre despacho real (#2317: 1 faltante detectado, despacho intacto).

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
