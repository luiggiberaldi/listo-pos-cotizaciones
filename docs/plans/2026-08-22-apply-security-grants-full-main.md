# Aplicación controlada de 06 completo — principal

**Fecha:** 2026-08-22  
**Proyecto:** principal (`oyfyuszgjwcepjpngclv`)  
**Objetivo:** revocar las mutaciones directas de las tablas de source-of-truth y el `EXECUTE` de las RPC legacy después del cutover del Worker.

## Alcance aplicado

El archivo fuente `supabase/release/main/06_security_grants_review.sql` conserva `REVIEW_ONLY`. El runner `scripts/apply-security-grants-full-main.mjs` validó la confirmación, retiró el bloque únicamente en memoria y ejecutó el SQL resultante dentro de una transacción.

Se aplicó sobre:

- `productos`.
- `inventario_movimientos`.
- `despacho_devoluciones`.
- `despacho_devolucion_intercambios`.
- `cuentas_por_cobrar`.
- `comisiones`.

Cambios de permisos:

- `anon` y `authenticated`: conservan `SELECT`; no tienen `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` ni `MAINTAIN` sobre las seis tablas.
- `service_role`: conserva la capacidad necesaria para el Worker.
- RPC legacy de entregas, devoluciones, finanzas y productos: `EXECUTE` revocado para `PUBLIC`, `anon` y `authenticated`; `service_role` conserva `EXECUTE`.
- RPC tenant-safe nuevas: disponibles para `service_role`; no expuestas a `anon`/`authenticated`.

No se ejecutó ninguna corrección histórica ni backfill del Kardex.

## Gates y evidencia previa

- Target validado por el runner: `oyfyuszgjwcepjpngclv`.
- Las seis tablas y las 20 funciones neutrales requeridas estaban presentes.
- Baseline inmediatamente antes/después del apply:

| Métrica | Antes | Después |
|---|---:|---:|
| Productos | 445 | 445 |
| Stock total | 284.317 | 284.317 |
| Movimientos Kardex | 3.715 | 3.715 |
| Devoluciones | 19 | 19 |
| Intercambios de devolución | 3 | 3 |
| CxC | 492 | 492 |
| Comisiones | 713 | 713 |

`dataUnchanged: true` en `tmp/apply-security-grants-full-main/apply-result.json`.

### Backup

- Backup de datos completo de la misma sesión: `tmp/backups/kardex-principal-full-2026-08-22T00-10-59.dump`.
  - 3.108.964 bytes.
  - SHA-256: `e7a4a8e59b62bcc712463def3f9941ec68ca847bab947841cddbe650b46b69c1`.
  - `pg_restore --list`: PASS.
- Backup inmediato específico para este cambio: `tmp/backups/kardex-principal-schema-acl-pre-06-2026-08-22T02-01-50-586Z.sql`.
  - 750.569 bytes.
  - SHA-256: `71c8a52dcea6a5b6e626b91b41b4137266ec3f3a477dae8e341cde234e72b030`.
  - Alcance: esquema y ACLs; no contiene filas.

El intento de generar otro dump completo justo antes del apply superó el timeout operativo de 10 minutos. No se presenta el dump de esquema/ACL como sustituto de un backup de datos: el dump completo anterior es el backup de datos disponible y el de esquema/ACL es el respaldo específico de permisos. Para una ventana futura, usar el backup nativo del Dashboard de Supabase o `npm run backup:kardex:main` con el timeout de 30 minutos.

## Postflight read-only

Runner: `npm run postflight:security:grants:main:full`.

Resultado: **PASS**.

- Proyecto, base y versión confirmados: PostgreSQL 17.6.
- Tablas faltantes: 0.
- Funciones nuevas faltantes: 0.
- Funciones legacy faltantes: 0.
- Fallos de grants de tablas: 0.
- Fallos de grants de RPC legacy: 0.
- Fallos de grants de RPC nuevas: 0.
- Los seis grupos de permisos mutantes quedaron en `false` para `anon` y `authenticated`.
- `SELECT` quedó disponible y `service_role_insert` quedó en `true` para las seis tablas.
- Baseline actual igual al baseline capturado por el apply: **PASS**.

El postflight es read-only y se dejó reproducible en `scripts/postflight-security-grants-full-main.mjs`.

## Smoke funcional posterior

Se repitió el smoke con tenant temporal y aislado:

```bash
KARDEX_MAIN_SMOKE_CONFIRM=RUN_PRODUCT_SMOKE npm run smoke:products:main
```

Resultado: **PASS**.

- Crear producto vía Worker: PASS.
- Replay de creación: PASS e idempotente.
- Actualizar stock `0 → 2`: PASS.
- Replay de actualización: PASS e idempotente.
- Borrar producto vía Worker: PASS, egreso `2 → 0`.
- Replay de borrado: PASS e idempotente.
- Provenance: `product_update` y `product_delete`.
- Tres claves en `inventario_operaciones` y tres filas de auditoría.
- Limpieza del tenant temporal: PASS; usuario, producto, movimientos, operaciones y auditoría temporales eliminados.

No se mutaron productos del tenant real durante el smoke.

## Auditoría Kardex posterior

Auditoría read-only posterior al smoke:

- Errores matemáticos: **0**.
- Saltos de continuidad todavía presentes: **66**, en **37 productos**.
- Movimientos históricos sin `origen_tipo`, `origen_id` o `idempotency_key`: **3.691 de 3.715**.
- Movimientos huérfanos respecto a producto: **0**.
- Diferencia catálogo vs último Kardex: **1** entre **369** productos con movimiento.

Esto no contradice el éxito de 06: 06 evita nuevas mutaciones directas y obliga al flujo nuevo, pero no inventa la causa de los saltos históricos ni los corrige. La reconciliación/backfill histórico sigue siendo una fase separada y debe ejecutarse con plan, evidencia por producto, `batch_key`, snapshot y rollback ensayado.

## Rollback

Artefacto: `tmp/apply-security-grants-full-main/rollback-06-full-main.sql`.

El rollback fue corregido para no otorgar todos los privilegios a todas las tablas. Primero revoca los privilegios de `anon`/`authenticated` en las tablas objetivo y luego restaura únicamente el estado efectivo observado en el preflight; para RPC legacy restaura solo las firmas que tenían `EXECUTE` antes del apply.

No se ejecutó rollback porque el postflight fue PASS. Requiere:

1. Confirmar que no hubo cambios de ACL posteriores al apply.
2. Confirmar backup disponible.
3. Aprobar explícitamente `KARDEX_MAIN_CONFIRM=ROLLBACK_SECURITY_GRANTS_FULL`.
4. Ejecutar `npm run security:grants:main:full -- --rollback` y verificar el resultado.

El rollback no debe usarse para ocultar fallos funcionales ni para reabrir permanentemente escrituras directas.

## Pendientes y decisión de siguiente fase

- `TesterFlowView.jsx` aún conserva deletes directos de `cuentas_por_cobrar` y `inventario_movimientos` (`src/views/TesterFlowView.jsx:334` y `:1451`). Después de 06 esos deletes deben considerarse bloqueados por diseño; hay que terminar su migración a RPC/Worker para que el cleanup de pruebas sea funcional.
- No aplicar todavía backfill histórico ni deduplicación de las brechas sin provenance.
- Preparar el plan de reconciliación por producto, empezando por los 37 productos con saltos de continuidad y el producto con diferencia catálogo/Kardex.
- Rotar el token de Cloudflare compartido durante el despliegue anterior.
- Mantener `06_security_grants_review.sql` con `REVIEW_ONLY`; el apply reproducible queda encapsulado en el runner con confirmación explícita.

## Archivos de evidencia

- `tmp/apply-security-grants-full-main/apply-result.json`.
- `tmp/apply-security-grants-full-main/rollback-06-full-main.sql`.
- `scripts/apply-security-grants-full-main.mjs`.
- `scripts/postflight-security-grants-full-main.mjs`.
- `scripts/smoke-product-worker-main.mjs`.
- `docs/plans/2026-08-22-smoke-product-worker-main.md`.
- `BITACORA.md`.
