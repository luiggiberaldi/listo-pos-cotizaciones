# Matriz de migraciones — Construacero Carabobo

> Última revisión documental: 2026-09-05. El estado de ejecución solo se marca ✅ cuando una sesión de la `BITACORA.md` lo confirmó con verificación post-apply (postflight, smoke o E2E). Todo lo demás queda ❓ — **no inventar estado**.

## Leyenda

- ✅ Confirmado aplicado (con verificación registrada en bitácora).
- ⚠️ Pendiente o requiere verificación.
- ❓ No verificable desde el repositorio.
- 🗃️ Histórico/reemplazado (una migración posterior redefinió los mismos objetos).

## Convenciones del repo

- `supabase/migrations/` — migraciones incrementales del **principal** (numeradas `NNN_*.sql`; existen dos `202_*` y utilitarios sin número como `debug.sql` — no son migraciones).
- `construacero-staging/supabase/migrations/` — espejo de staging (numeración independiente, llega hasta `267_*`).
- `supabase/release/main/` — releases promovidos al principal (paquetes `238a/238b`, `01–07` con rollbacks).
- `supabase/release/principal/` y `supabase/release/staging/` — paquetes puntuales con `00_preflight` / `99_postflight`.
- **Lección 262→263 (crítica):** un `CREATE OR REPLACE` posterior puede pisar fixes de migraciones anteriores. Antes de promover una función, auditar su cadena completa (ver `scripts/audit-function-chains.mjs` en staging) y verificar el cuerpo vivo tras aplicar.

## Migraciones y releases financieros / de seguridad (los de mayor riesgo)

| Archivo / Release | Área | Producción | Staging | Rollback | Validación | Notas |
|---|---|---:|---:|---:|---|---|
| `238a_contract_neutral_review.sql` + rollback | Contratos RPC (neutro) | ✅ | ✅ | ✅ Incluido | Dry-run + apply documentados en bitácora 2026-08-23 | Base de la cadena 238 |
| `238b_comisiones_guardrails_review.sql` (v4, 5 args) | Comisiones (cálculo) | ✅ (vía release 07) | ✅ (257→260→266→267) | ✅ | E2E staging 123/123 ×2 (2026-09-05); recálculo en vivo despacho #2958 | Firma `(uuid) → uuid`; el delegador legacy `calcularcomisiondespacho` lo creó 257 |
| `239_comisiones_corte_adelante_238b.sql` | Comisiones (corte) | ✅ | ✅ | ❓ | Bitácora 2026-08 | Corte de comisiones "hacia adelante" |
| Release `03_comision_split_cliente_ajeno` (`release/principal/`) | Comisiones split v1 | ✅ | 🗃️ (reemplazado por 257) | ✅ Incluido | Bitácora 2026-09 | v1 del split por cliente ajeno |
| `257_staging_comision_split_cliente_ajeno.sql` | Comisiones split v2 | ❓ (llegó vía release 07) | ✅ | ❓ | E2E staging | Introdujo multi-fila split y el delegador |
| Release `05_devolucion_reembolso_atomico` (`release/principal/`) | Finanzas (reembolso) | ✅ | ✅ (262) | ✅ Incluido | Runbook F0–F5 (2026-09-05) | Reembolso multi-método atómico |
| `262_staging_devolucion_reembolso_atomico.sql` | Finanzas (reembolso) | ❓ (equivalente: release 05) | ✅ | ❓ | Runbook 2026-09-05 | ⚠️ Pisó el bucle multi-fila de 257; corregido por 263 |
| `263_staging_fix_ajustar_finanzas_multi_fila.sql` | Finanzas (multi-fila) | ❓ (equivalente dentro de release 07) | ✅ | ❓ | E2E staging | Restaura escalado multi-fila en devoluciones |
| Release `06_reversion_con_devoluciones` (`release/principal/`) | Finanzas (reversión) | ✅ | ✅ (264) | ✅ Incluido | Reversión consciente (2026-09-05) | Revierte despachos con devoluciones previas |
| `265_staging_designado_no_externo.sql` | Seguridad (trigger designación) | ✅ (incluido en release 07) | ✅ | Trigger DROP | E2E ×2 | Excluye externos del designado (defensa en profundidad) |
| `266_staging_tz_caracas_comisiones.sql` | Comisiones (TZ) | ✅ (parche vivo equivalente) | ✅ | ❓ | E2E ×2 post-cambio | `EXTRACT(dow ...)` en `America/Caracas`; sin esto, ventas sabatinas tras 8:00 PM VE no spliteaban |
| `267_staging_split_v31_cliente_propio.sql` | Comisiones (regla v3.1) | ✅ (parche vivo equivalente) | ✅ | ❓ | E2E ×2 + paridad byte a byte (`verify-parity-238b.mjs`) | Cliente propio también splittea (1.5% dueño + 0.5% designado); guardia designado=dueño intacta |
| Release `07_comision_split_designado_v3_review.sql` | Comisiones split v3 completo | ✅ (postflight verde) | ❓ (equivalentes 260–267) | ✅ `07_rollback_aplicar.sql` | Postflight + E2E + Vitest 319/319 | Tabla `comision_designacion_diaria`, RPC designación, toggle `comision_split_activo` (arrancó OFF) |
| `06_security_grants_review.sql` / `06a_security_grants_safe.sql` | Seguridad (grants) | ✅ | ✅ | ❓ | Auditoría de escrituras 2026-08-22 | Requiere preservar firmas/EXECUTE |
| `253_staging_service_role_grants.sql` | Seguridad (grants staging) | ❓ | ✅ | ❓ | Bitácora 2026-08 | Grants para service role en staging |
| `251_staging_p0_financial_idempotency.sql` | Finanzas (idempotencia) | ❓ (concepto en 04) | ✅ | ❓ | Bitácora 2026-08 | Idempotencia P0 |
| Release `04_consumo_credito_cxc` (`release/principal/`) | CxC | ✅ | ✅ (258) | ✅ Incluido | Bitácora 2026-09 | Consumo de crédito CxC |

## Migraciones de inventario / kardex (release `main/01–05b`)

| Archivo / Release | Área | Producción | Staging | Rollback | Validación | Notas |
|---|---|---:|---:|---:|---|---|
| `01_kardex_provenance.sql` | Kardex | ✅ | ✅ (246, 250 backfill) | ❓ | Auditoría 3.401 movimientos, 0 errores matemáticos | Provenance estructurado |
| `02_inventory_atomic_operations.sql` | Inventario | ✅ | ✅ (244) | ❓ | Suite E2E + Vitest | Operaciones atómicas |
| `03_return_finance_atomic.sql` | Devoluciones | ✅ | ✅ (245, 252) | ❓ | Suite E2E | Finanzas de devolución atómicas |
| `04_idempotency_wrappers.sql` | Inventario | ✅ | ✅ (247, 249, 255) | ❓ | Suite E2E | Wrappers idempotentes |
| `05_inventory_guardrails_and_reconciliation.sql` + `05b` | Inventario | ✅ | ✅ (248) | ❓ | Reconciliación 66 saltos documentada | Guardarraíles |

## Otras migraciones del principal (muestra de las demás áreas)

| Archivo | Área | Producción | Staging | Notas |
|---|---|---:|---:|---|
| `013_rls_enable_and_policies.sql` (histórico temprano) | Seguridad RLS | ✅ | ✅ | RLS en 9 tablas, helper `get_rol_actual()` |
| `200_comision_cxc_manual.sql` | Comisiones CxC manual | ✅ | ✅ | CxC manual se registra aparte |
| `204_kardex_stock_negativo_guard.sql` | Inventario | ✅ | ✅ (243 compat) | Guardarraíl stock negativo |
| `205_venta_anticipada.sql` | Ventas | ✅ | ✅ | `permitir_stock_negativo` |
| `221_transportistas_liquidacion_atomica.sql` | Transportistas | ✅ | ✅ | Liquidación atómica |
| `226_devolucion_parcial_finanzas_atomicas.sql` | Finanzas | ✅ | ✅ | Devolución parcial atómica |
| `233_unificar_rpc_productos.sql` | Productos (RPC 16 args) | ✅ | ✅ | Firma nueva verificada en auditoría de cadenas |
| `236_configuracion_global_choferes_20.sql` + `237` | Configuración | ✅ | ✅ | Paquete correctivo con preflight readonly |
| `240_fix_reporte_ventas_corte_y_cuenta.sql` | Reportes | ✅ | ✅ (259 espejo) | Espejo aplicado en staging |

> La tabla anterior es una muestra de alto riesgo/impacto, no un índice exhaustivo de las 224+251 migraciones. Para el resto aplica ❓ hasta verificar con la base correspondiente.

## Procedimiento para actualizar esta matriz

1. Ejecutar contra **cada** entorno una consulta de `pg_proc`/`pg_tables` o comparar el cuerpo vivo con el repo (patrón: `scripts/verify-parity-238b.mjs`, `scripts/audit-live-vs-repo.mjs` de staging).
2. Confirmar en `BITACORA.md` que la sesión que aplicó la migración registró verificación post-apply; solo entonces marcar ✅.
3. Si una migración nueva redefine objetos de otra, marcar la antigua 🗃️ y enlazar la que quedó vigente (lección 262→263).
4. Registrar la fecha de verificación y el script/consulta usado en la columna Validación.
5. Commitear la matriz junto con la migración que la motiva.
