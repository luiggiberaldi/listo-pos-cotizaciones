# Release 17 — Cutover en staging (2026-10-19) · Evidencia y runbook

**Proyecto:** `construacero staging` (ref `spupqgkdsgohxxfoxydl`, PostgreSQL 17.6, ACTIVE_HEALTHY)
**Canal:** conector Supabase (cuenta `supabase_scray-german` → supabase_scray / listoposcotizaciones)
**Plan:** [docs/plans/2026-10-19-plan-egreso-inventario-al-aprobar-despacho.md](../plans/2026-10-19-plan-egreso-inventario-al-aprobar-despacho.md)

---

## 1. Qué se ejecutó (en orden)

| Paso | Artefacto | Resultado |
|---|---|---|
| Pre-imágenes | `supabase/release/main/17_backup_cuerpos/*.live.sql` (6 cuerpos) + stash `release_17_backup_cuerpos` en BD | byte-exactos vs `md5(pg_get_functiondef())` vivo |
| Apply | `17_egreso_inventario_aprobacion_apply.sql` (sin `BEGIN;`/`COMMIT;`, ejecución atómica) | md5 payload `7f9a34ce8b9a5679e09153d55ef7a629` (43.420 chars) verificado en servidor antes de `EXECUTE` |
| Backfill | `17_egreso_inventario_backfill.sql` (operador fijado: luigi) | md5 payload `9cdb5991ca9a4b28d2304a90ef90119b` (7.143 chars) verificado en servidor antes de `EXECUTE` |
| Postflight | `17_egreso_inventario_postflight_readonly.sql` | ver §3 |

**Garantía de fidelidad de transporte:** ambos payloads viajaron por el conector en trozos de ≤2.000
chars con `md5` por trozo y `md5(string_agg(...))` total comparado con el md5 local **antes** de
ejecutar. La ejecución fue un `DO` con guardia de md5 + `EXECUTE` (transacción única): si el
ensamblado no coincidía byte a byte, abortaba sin tocar nada.

**Ajuste obligatorio aplicado al backfill** (según su propio encabezado): `v_usuario_id :=
'b40a90d3-e9a8-41f2-b631-edd4ea14ad78'::uuid` (luigi, supervisor), `v_usuario_nombre :=
'MIGRACIÓN release 17'`. Confirmado por el usuario el 2026-10-19.

## 2. Estado post-apply (verificado)

- 7 firmas vivas: `aprobar_despacho_inventario_atomico` (5), `confirmar_entrega_inventario_atomica` (6),
  `revertir_entrega_inventario_atomica` (5), `revertir_despacho_inventario_atomica` (5, **NUEVA T4**),
  `editar_despacho_profundidad` (2/5/6 args).
- Comentario de propiedad `Main egreso-inventario release 17…` en las firmas canónicas
  (las sobrecargas delegadas 2-arg y 5-arg no lo portan; es el diseño del apply).
- Columnas nuevas en `notas_despacho`: `alerta_stock boolean`, `alerta_stock_items jsonb`,
  `egreso_lote_id uuid`.
- Permisos: vivas ejecutables **solo** por `service_role` (anon/authenticated/PUBLIC revocados);
  obsoletas (`obtener_stock_comprometido`, `_detalle`, `crear_nota_despacho`, `anular_despacho_atomico`)
  sin EXECUTE para nadie (DROP posterior coordinado).

## 3. Evidencia del backfill (postflight)

**Invariante de cutover:** todo `despachada`/`entregada` tiene `egreso_lote_id` → **0 sin lote**.

| Estado | Despachos | Sin egreso_lote | Con alerta |
|---|---|---|---|
| despachada | 10 | 0 | 8 |
| entregada | 997 | 0 | 0 |

**Kardex de migración** (`motivo LIKE 'MIGRACIÓN — egreso por cambio de modelo%'`):
34 movimientos · 10 lotes · 24 productos · 1.204,00 unidades · autor `MIGRACIÓN release 17`
(`b40a90d3-e9a8-41f2-b631-edd4ea14ad78`).

**Sellos deterministas:** 10/10 despachadas con lote `md5('migra-egreso-17-'||id)::uuid`;
997/997 entregadas con sello `md5('migra-egreso-17-legado-'||id)::uuid`; 1.007 con lote en total.

**Alertas de stock (nivel × items):** BAJO 3 · NEGATIVO 7 (8 despachadas marcadas).

**Detalle despachadas egresadas:**

| # | lote egreso | alerta | movimientos | unidades |
|---|---|---|---|---|
| 1898 | e2610435-b429-62f3-dc4a-04cf94a35739 | no | 1 | 720,00 |
| 1919 | a6a32bbb-5968-5ac4-a0a0-06888b437a04 | sí | 1 | 16,00 |
| 1930 | d7ab6765-e337-6445-d0f3-621319cbf14a | sí | 1 | 60,00 |
| 1931 | 1f6643d2-824c-ac8a-f4ae-d8cfecfa1f36 | sí | 1 | 2,00 |
| 1933 | 7fd0f2fd-0fb4-b187-8b43-12dd87e9140d | sí | 1 | 3,00 |
| 2144 | 0afcf3e5-2050-a657-996a-194b6b24acb9 | no | 7 | 8,00 |
| 2458 | 732ad68a-4daf-3555-2859-230cb0cc337b | sí | 5 | 44,00 |
| 2534 | 6dcf6067-3230-ca9e-0cbc-fa5f4d87d0d1 | sí | 2 | 83,00 |
| 2547 | 9003d3d9-c557-ee59-0a8e-be53033dde5e | sí | 11 | 155,00 |
| 2548 | d4a69edd-6c39-de89-dc3e-59ab47267cce | sí | 4 | 113,00 |

**Nota sobre la comprobación textual `toca_productos` de `confirmar_entrega_inventario_atomica`:**
da `true` porque su rama de **entrega directa desde `pendiente`** (auto-entrega, `v_egreso`) sí egresa
en ese momento — es la excepción diseñada en T2, no una regresión. La entrega normal desde
`despachada` no toca inventario (el egreso ocurrió al aprobar/backfill).

## 4. Ventana de cutover (obligatoria)

Entre este apply/backfill y el **deploy del Worker + frontend** release 17:

- **No aprobar ni revertir despachos en producción** con el Worker legacy: al devolver desde
  `despachada` el Worker legacy no reingresa y rompería el invariante `egreso_lote_id`.
- El backfill es **idempotente** (solo procesa `egreso_lote_id IS NULL` + guarda por producto × lote):
  puede re-ejecutarse sin doble efecto si hiciera falta.

## 5. Rollback

1. Restaurar los 6 cuerpos vivos pre-imagen (byte-exactos):
   `supabase/release/main/17_backup_cuerpos/<fn>.live.sql` — o desde el stash en BD
   `release_17_backup_cuerpos` (misma verificación md5).
   Revisar primero `17_egreso_inventario_rollback_review.sql` (guards del rollback).
2. Revertir el backfill: **ya automatizado** en `17_egreso_inventario_rollback_review.sql`
   (reingreso espejo de los lotes `md5('migra-egreso-17-'||id)` + limpieza de sellos
   `alerta_*`, y limpieza de los sellos legado `md5('migra-egreso-17-legado-'||id)` de las
   997 entregadas que solo tienen sello, con guarda `NOT EXISTS` sobre el kardex).
   **Dry-run verificado el 2026-10-19:** 34 pares (despacho×producto) ↔ 34 movimientos de
   migración, 1.204,00 ud ↔ 1.204,00 ud, 0 desajustes, 0 fuera de estado. El kardex jamás se
   borra: la inversión es `+cantidad` con motivo `ROLLBACK release 17`.
3. Columnas nuevas: se conservan (son aditivas y con `IF NOT EXISTS`); si se retiran,
   `ALTER TABLE notas_despacho DROP COLUMN ...` solo después de restaurar las funciones.

## 6. Corrección durante el smoke (bug 42804, aplicada al artefacto y a la BD)

El smoke de Fase 7 descubrió un bug real que la verificación byte a byte no podía ver (el
artefacto mismo lo contenía): en `editar_despacho_profundidad`, rama de delta en `despachada`,
la expresión `CASE … THEN 'egreso' ELSE 'ingreso' END` produce `text` y la columna
`inventario_movimientos.tipo` es del enum `tipo_movimiento` → **ERROR 42804** al insertar el
kardex de ajuste. Corregido con cast `::tipo_movimiento` en:

- Artefacto: `17_egreso_inventario_aprobacion_apply.sql:1061` (md5 nuevo del payload).
- BD: sobrecarga canónica de `editar_despacho_profundidad` (6 args) reaplicada y verificada.

Tras el fix, la Fase 7 pasó (delta −2 → 94→96 con kardex de ajuste). Los demás INSERT del
artefacto usan literales que sí coercen al enum; no se tocaron.

## 7. Smoke RPC-level completo (2026-10-19, staging)

Ejecutado vía conector (cuenta `supabase_scray-german`) con fixtures propios de prueba,
según el plan §5.4/§5.5 — todas las transiciones cubiertas:

| # | Transición | Resultado |
|---|---|---|
| 1 | aprobar `pendiente→despachada` | −stock + kardex `egreso` ✓ |
| 2 | entregar `despachada→entregada` | inventario `sin_movimiento`, `movimientos: 0` ✓ |
| 3 | revertir entrega a `despachada` | sin reingreso ✓ |
| 4 | revertir a `pendiente` | reingreso 90→100, lote `NULL`, kardex `egreso`+`ingreso` ✓ |
| 5 | editar en `pendiente` (10→6) | ítems reemplazados, stock intacto (100), kardex sin cambios ✓ |
| 6 | aprobar de nuevo | egreso 100→94, `despachada`, lote nuevo ✓ |
| 7 | editar en `despachada` (6→4) | delta −2 → 94→96 + kardex de ajuste ✓ (**tras fix §6**) |
| 8 | auto-entrega desde `pendiente` | egresa al entregar (96→91), `entregada`, lote sellado ✓ |
| 9 | alertas de stock | la venta nunca se bloquea: 3→1 con alerta `BAJO` ✓ |
| 10 | concurrencia (§5.5) | dos aprobaciones simultáneas sobre el mismo producto: `FOR UPDATE` serializa (100→96→93), 100−3−4=93 exacto, 8 movimientos, sin update perdido ✓ |
| 11 | limpieza | 0 residuos de fixtures (criterio del runbook) ✓ |

Contratos locales re-ejecutados tras el fix del §6: suite de contratos de release 12/12 verde.

## 8. Pendiente y bloqueos

- **E2E 123/123 del árbol staging: BLOQUEADO por credenciales.** El runner exige secretos que
  solo posee el usuario/CI (solo existen `.example`):
  - `STAGING_E2E_ANON_KEY` (anon key del proyecto staging) → `construacero-staging/.env.e2e.local`
  - `SUPABASE_SERVICE_KEY` (**service key de staging**) → `construacero-staging/.dev.vars`
    (provisión de la cuenta E2E + `switch-operator`)
  - `STAGING_E2E_EMAIL`/`STAGING_E2E_PASSWORD` de una cuenta exclusiva de staging (si no se
    provisiona automáticamente con la service key)
  - El README prohíbe explícitamente usar claves de producción; las claves locales de la raíz
    (`supabase_scray` vía `.env`) pertenecen al proyecto **producción** `oyfyuszgjwcepjpngclv`
    y no son válidas aquí. Alternativas: (a) el usuario entrega los secretos de staging;
    (b) correr el nightly de CI (`e2e-staging-legacy`) con los secretos de GitHub.
- **Falta para producción** (para que el usuario despliegue):
  1. GATE: backup verificable de **producción** (productos, inventario_movimientos,
     notas_despacho(_items)) + restore probado (plan §6.1).
  2. Apply del release SQL en producción con el mismo protocolo md5-por-trozos (artefactos
     ya empaquetados y probados en staging).
  3. Backfill T6 en producción con operador real + evidencia por despacho (script idempotente).
  4. Deploy **Worker + frontend juntos** (`./deploy.sh`) — en la misma ventana: la ventana de
     cutover (§4) prohíbe dejar el Worker legacy contra la BD nueva.
  5. Smoke semántico post-deploy en producción (plan §5) con producto de prueba.
  6. Commit del release: los cambios T7/T8/T9 viven sin confirmar en el working tree.
  7. (Posterior, coordinado) DROP de las 4 RPCs obsoletas (plan §4.3).
