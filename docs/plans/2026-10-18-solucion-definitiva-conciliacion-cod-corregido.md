# Plan Corregido — Release 14: Conciliación Atómica COD (Proyecto de Producción)

> **Fecha:** 2026-10-18 · **Estado:** ✅ EJECUTADO — Tareas 0–5 completadas el 2026-10-18 (apply en producción + postflight 16/16 + smoke 36/36 vía PostgREST + rollback ensayado 13/13). **Pendientes solo los gates §12.3 (revisión DBA del historial de migraciones + método manual auditable de apply), §12.4 (SHA del Worker aprobado por escrito) y §12.6 (re-suite sobre el SHA aprobado).**
> **Supersede a:** `2026-10-18-solucion-definitiva-conciliacion-cod.md` (y su copia raíz `PLAN_SOLUCION_DEFINITIVA_COD.md`)
> **Corrige:** rutas inexistentes, contradicciones de deploy/rollback, y contratos ambiguos (pago parcial, idempotencia, snapshot Bs). Todo lo afirmado aquí fue verificado contra los dos checkouts reales el 2026-10-18.
>
> **ALCANCE (decisión del negocio, 2026-10-18):** el release es **puramente preventivo** — su objetivo es que los COD **nuevos** no generen desfasajes. Los COD históricos **NO se concilian ni regularizan** salvo que sea completamente necesario (p. ej., que el cliente efectivamente venga a pagar su deuda; en ese caso el flujo nuevo los atiende de forma segura). Los casos de §14 quedan congelados sin acción.

**Rutas verificadas:**
- **Producción (este repo):** `c:\Users\luigg\Desktop\construacero`
- **Fuente "solo lectura" (ERP):** `C:\Users\luigg\Desktop\sistemas personalizados\construacero\ERP\listo-pos-cotizaciones` (en adelante `<ERP>`)

---

## 1. Estado verificado (reemplaza la tabla "Estado actual" del plan original)

> **Nota de estado (2026-10-18):** la tabla siguiente captura el estado **al redactar el plan** (previo a la ejecución). Las Tareas 0–5 quedaron ejecutadas el mismo día — ver los bloques ✅ de §4, §5, §6, §7, §8, §10 y §11. Gates abiertos: solo §12.3, §12.4 y §12.6.

| Componente | Producción | ERP (fuente) | Notas |
|---|---|---|---|
| `14_cod_preflight_readonly.sql` | ❌ ausente | ✅ existe (59 líneas) | Copiar |
| `14_cod_financial_rpcs_review.sql` | ❌ ausente | ✅ existe (601 líneas, gate REVIEW_ONLY en líneas 15–19, dentro de `BEGIN…COMMIT`) | Copiar |
| `14_cod_postflight_readonly.sql` | ❌ ausente | ✅ existe (54 líneas) | Copiar |
| `14_cod_rollback_review.sql` | ❌ ausente | ✅ existe (36 líneas) | **El plan original no lo mencionaba.** Copiar |
| `docs/runbooks/cutover-cod-release-14.md` | ❌ ausente | ✅ existe (115 líneas) | Copiar |
| `docs/runbooks/cod-release-14-review-packet.md` | ❌ ausente | ✅ existe (109 líneas) | Copiar (requerido por el runbook) |
| `docs/runbooks/rollback-base-de-datos.md` | ✅ existe | — | Referenciado por el runbook; OK |
| `api/handlers/cod.js` | ✅ **idéntico al ERP** | ✅ | Sin acción |
| `src/utils/codCurrency.js` | ✅ **idéntico al ERP** | ✅ | Sin acción |
| Rutas `/api/despachos/resumen-financiero` y `/api/despachos/conciliar-cod` | ✅ cableadas en `worker.js` | — | Sin acción |
| `ConciliarCodModal.jsx` | ❌ versión legacy 2 pasos (399 líneas) | ✅ versión nueva (282 líneas) | Reemplazar |
| Tests COD (4 archivos) + harness (2 scripts + `scripts/lib/`) | ❌ **ausentes** | ✅ existen | Copiar (ver §4) |
| `vitest.config.js` y `package.json` (`test:cod`, `test:cod:browser`, `verify:cod:release-local`) | ✅ ya declarados | — | Apuntan a archivos que faltan |
| Dependencias `pg` y `playwright` | ✅ en package.json | — | Sin acción |
| Dependencias del modal nuevo (`useTasaCambio`, `authFetch`, `Modal`, `Toast`, `formasPago`) | ✅ todas existen | — | Reemplazo drop-in (misma firma `{ isOpen, onClose, despacho }`, usado por `DespachoCard.jsx`) |

**Dato verificado:** `npm run test:cod` en producción **falla hoy** (exit 1, "No test files found") porque los 4 archivos de test no existen. Esto es esperado hasta ejecutar la Tarea 0.

---

## 2. Correcciones respecto al plan original

1. **Rutas:** los artefactos no están en un `ERP/` relativo; están en `<ERP>` (ruta absoluta de arriba). El manifest de copia de §4 los lleva a las rutas que el test `codMainRelease.test.js` espera (`../../../supabase/release/main/…`, `../../test-cod-main-release-local.mjs`, `../../../docs/runbooks/…`).
2. **Orden de deploy (contradicción resuelta):** el orden es **obligatorio**: SQL → postflight → Worker → Frontend. (El runbook, Fase 4.6: "coordinar el despliegue del Worker únicamente después de tener disponibles ambas RPC". El frontend va después del Worker porque consume sus endpoints.)
3. **Rollback (contradicción resuelta):** NO hay "cuerpos previos" que restaurar — el preflight exige que las funciones **no existan** (`PRECONDICION_FUNCION_EXISTENTE`). El rollback es `14_cod_rollback_review.sql` (con su propio gate REVIEW_ONLY y guards `ROLLBACK_14_COD_*_OWNER_MISMATCH` por comentario de propietario), que hace `DROP FUNCTION` de ambas RPC y **retiene** `cod_conciliacion_idempotencia` como historial financiero.
4. **Pago parcial (contrato real del SQL):** el plan original decía que el Paso 3.6 pone `cobro_destino_pagado: true` **sin condición** — incorrecto. El SQL real hace `'cobro_destino_pagado', (v_deuda_cod - v_total_pago) <= 0`. Reglas exactas:
   - Pago **menor** a la deuda COD → permitido: abonos parciales, flag `false`, resultado `estado_cod: 'parcial'`, **no** recalcula comisión.
   - Pago **igual** a la deuda → flag `true`, `estado_cod: 'cobrado'`, ejecuta `recalcularcomisiondespacho_238b` **una sola vez**.
   - Hasta **USD 0.01 de exceso** → permitido y reportado como `excedente_usd`; cualquier saldo pendiente (aunque sea $0.01) deja estado `parcial`.
   - Exceso mayor a $0.01 → `COD_CONCILIACION_MONTO_NO_COINCIDE` (rechazo total, sin escrituras).
5. **Idempotencia (contrato real del SQL):**
   - Misma clave + **mismo payload** (`md5(despacho_id, pagos, evidencia)`) → devuelve el resultado almacenado + `idempotent: true`, sin duplicar abonos/auditoría.
   - Misma clave + **payload distinto** → `COD_CONCILIACION_IDEMPOTENCIA_REUTILIZADA` (400).
   - El modal genera la clave **al abrir** y la conserva durante reintentos; al reabrir, relee el resumen del ledger y bloquea el botón si ya está saldado (protección contra doble cobro tras timeout).
   - **Riesgo residual CERRADO (2026-10-18):** el Worker ya **no** genera una clave nueva si el cliente no envía una — `cod.js` exige la `Idempotency-Key` (body o header) y responde 400 si falta, sin fallback aleatorio. El smoke de replay debe hacerse con `curl` reenviando **el mismo body byte a byte**, no desde la UI.
6. **Snapshot Bs (contrato real):** `tasa_actualizada_en` del cliente es **opcional**; el campo de fecha inmutable que siempre se graba es `tasa_confirmada_en` (timestamp del servidor). Regla de redondeo: **half-up** a centavos, equivalente a `round(numeric,2)` de PostgreSQL (coincide con `convertBsToUsd` de BigInt). Tasa a 8 decimales; `monto_bs` y `monto` a máximo 2. Cada abono parcial conserva su snapshot independiente; cambios futuros de tasa no revalúan abonos anteriores.
7. **Ambos JSON se actualizan de forma independiente:** `forma_pago` y `forma_pago_cliente` se recalculan cada uno desde su propia fuente, conservando sus entradas no-COD. Cada uno debe tener exactamente **un** entry `cobro a destino` con monto nominal coherente (±$0.01); ausente/duplicado/discrepante → `COD_CONCILIACION_COD_AMBIGUO` / `FORMA_PAGO_INVALIDA` sin cambios.
8. **Verificación de tests ampliada:** además de `npx vitest run` y `npm run build`, el runbook exige `npm run test:cod`, `npm run test:cod:browser` (Playwright/Chromium) y `npm run verify:cod:release-local` (PostgreSQL local 16+, clúster desechable bajo `.wrangler/`, flag `--verify-local`). 45/45 + 12 aserciones + 644/644 es la línea base ya probada en el ERP el 2026-10-06; hay que **repetirla sobre el SHA aprobado de producción**.
9. **Smoke de replay corregido:** el punto 5 del smoke original ("reintentar el mismo pago con la misma idempotencyKey") es imposible desde la UI (el modal genera clave nueva al abrirse). Se hace por `curl` contra `/api/despachos/conciliar-cod` con el body idéntico, y un tercer intento con la misma clave y payload alterado debe fallar con `IDEMPOTENCIA_REUTILIZADA`.
10. **Fuera de alcance (documentado, no bloqueante):** `src/views/TesterFlowView.jsx` sigue usando `/api/cxc/abono` en su flujo de prueba COD, y el endpoint legacy `/api/despachos/editar-pago` con `conciliado_sin_abono: true` permanece (el resumen lo marca `manual_review`, así que queda neutralizado). Evaluar su deprecación en un release posterior.

---

## 3. Contrato de la RPC atómica (resumen ejecutable)

`registrar_pago_externo_cobro_idempotente(p_cuenta_id, p_despacho_id, p_idempotency_key, p_usuario_id, p_usuario_nombre, p_pagos JSONB, p_evidencia TEXT, p_ip_origen TEXT) RETURNS JSONB` — `VOLATILE SECURITY DEFINER`, `search_path=public`, `EXECUTE` solo a `service_role`.

Flujo interno (1 sola transacción): advisory lock `pg_advisory_xact_lock(hashtextextended(cuenta_id:key))` → `FOR UPDATE` del despacho y del cliente → validaciones (estado `despachada`/`entregada`, rol en `administracion|jefe|supervisor|desarrollador` activo, tenant, deuda COD > 0, ledger no ambiguo, cargo COD = monto nominal) → check de idempotencia → inserción de la fila de replay (solo hash) → 1–6 abonos en `cuentas_por_cobrar` → actualización independiente de ambos JSON → fila `auditoria` (`COD_CONCILIADO_CON_EVIDENCIA`) → `recalcularcomisiondespacho_238b` si la deuda queda en 0 → resultado guardado en la fila de replay. Cualquier `RAISE EXCEPTION` revierte todo.

La lectura `resumen_financiero_despacho(cuenta_id, despacho_id) RETURNS JSONB` es `STABLE SECURITY INVOKER`; deriva el estado (`sin_cargo|pendiente|parcial|cobrado|compensado|manual_review`) del ledger CxC, **no** de flags legacy (`flag_pagado_legacy` y `conciliado_sin_abono_legacy` se reportan solo como evidencia).

---

## 4. Tarea 0 — Sincronización de artefactos ERP → Producción (NUEVA, obligatoria primero)

Copiar **sin modificar** desde `<ERP>` al repo de producción:

| Origen (`<ERP>/…`) | Destino (producción) |
|---|---|
| `supabase/release/main/14_cod_preflight_readonly.sql` | `supabase/release/main/14_cod_preflight_readonly.sql` |
| `supabase/release/main/14_cod_financial_rpcs_review.sql` | `supabase/release/main/14_cod_financial_rpcs_review.sql` |
| `supabase/release/main/14_cod_postflight_readonly.sql` | `supabase/release/main/14_cod_postflight_readonly.sql` |
| `supabase/release/main/14_cod_rollback_review.sql` | `supabase/release/main/14_cod_rollback_review.sql` |
| `docs/runbooks/cutover-cod-release-14.md` | `docs/runbooks/cutover-cod-release-14.md` |
| `docs/runbooks/cod-release-14-review-packet.md` | `docs/runbooks/cod-release-14-review-packet.md` |
| `src/components/despachos/ConciliarCodModal.jsx` | `src/components/despachos/ConciliarCodModal.jsx` (reemplaza el legacy) |
| `api/handlers/__tests__/cod.test.js` | `api/handlers/__tests__/cod.test.js` |
| `src/components/despachos/__tests__/ConciliarCodModal.test.js` | `src/components/despachos/__tests__/ConciliarCodModal.test.js` |
| `src/utils/__tests__/codCurrency.test.js` | `src/utils/__tests__/codCurrency.test.js` |
| `scripts/lib/__tests__/codMainRelease.test.js` | `scripts/lib/__tests__/codMainRelease.test.js` |
| `scripts/lib/__tests__/invariantes.test.js` | `scripts/lib/__tests__/invariantes.test.js` |
| `scripts/lib/invariantes.mjs` | `scripts/lib/invariantes.mjs` |
| `scripts/test-cod-main-release-local.mjs` | `scripts/test-cod-main-release-local.mjs` |
| `scripts/test-cod-modal-browser.mjs` | `scripts/test-cod-modal-browser.mjs` |
| `supabase/release/main/README.md` | `supabase/release/main/README.md` ⚠️ **(17.º archivo, obligatorio)** — el test exige la frase `no se promueven`; la versión de producción es anterior y no la tiene, lo que haría fallar `test:cod` tras la copia. Mismo documento en versión más nueva; reemplazar completo. |

Notas:
- `api/handlers/cod.js` y `src/utils/codCurrency.js` ya son **byte-idénticos**; no copiar.
- `codMainRelease.test.js` lee por ruta relativa los 4 SQL + el harness + el runbook + `supabase/release/main/README.md` (este último ya existe en producción). Si falta cualquier archivo del manifest, el test falla.
- Entorno **verificado el 2026-10-18**: Node v24 ✓; Playwright 1.62.1 con Chromium instalado ✓ (`test:cod:browser` puede correr); PostgreSQL 17 local en `C:Program FilesPostgreSQL` ✓ (el harness lo auto-detecta buscando versiones 18/17/16 en Program Files — no requiere PATH). Baseline producción: `npm test` **411/411 verde** (el "644/644" del runbook corresponde al checkout ERP con tests COD incluidos) y `npm run build` **verde**. El Worker desplegado **ya tiene** los endpoints COD (probe sin auth → `401 {"error":"No autenticado"}` JSON; un Worker viejo habría servido el HTML del SPA) — en T5 el paso "Deploy Worker" queda como confirmación de SHA, no como despliegue nuevo.

**Verificación de la tarea:**
```bash
npm run test:cod                 # → 45/45 + contract tests PASS
npm run verify:cod:release-local # → PASS (PostgreSQL desechable local)
npm test                         # → suite completa PASS
npm run build                    # → sin errores
```

**✅ EJECUTADO 2026-10-18 (Tarea 0 completa):** los 16 archivos del manifest fueron copiados desde `<ERP>` con SHA-256 idéntico en cada par (el «17.º», `docs/runbooks/rollback-base-de-datos.md`, ya existía en producción). **Artefacto adicional no listado en el manifest:** `src/test-fixtures/cod-modal/` (5 archivos: `authFetchMock.js`, `index.html`, `main.jsx`, `rateHookMock.js`, `vite.config.js`) — requerido por `test:cod:browser`; sin él el script fallaba con `Could not resolve …/src/test-fixtures/cod-modal/vite.config.js`. Copiado también y verificado por SHA. **Gates en verde:** `npm run test:cod` **45/45** ✓ · `npm run verify:cod:release-local` **PASS** ✓ (ensayo forward completo en PostgreSQL 17 desechable: idempotencia replay, pago parcial/excedente de $0.01, snapshots Bs, FK `ON DELETE RESTRICT`, contrato de ambos JSON) · `npm test` **514/514** ✓ · `npm run build` ✓ · `npm run test:cod:browser` **PASS** (12 aserciones, Chromium, sin Supabase) ✓.

**Nota de divergencia deliberada:** `api/handlers/cod.js` ya **no** es byte-idéntico al ERP — se eliminó el fallback `crypto.randomUUID()` de la `Idempotency-Key` (ahora **obligatoria** en body o header, 400 si falta), lo que **cierra el riesgo residual del §2.5**. Los 45 tests COD pasan sin cambios porque siempre envían la clave (body o header). No restaurar el fallback.

---

## 5. Tarea 1 — Preflight en Producción (solo lectura)

Ejecutar `<ERP>/supabase/release/main/14_cod_preflight_readonly.sql` (o su copia ya sincronizada) en el SQL Editor de Supabase **del proyecto principal**, con conexión de solo lectura.

**Resultado esperado (línea base del runbook, 2026-10-05):** `missing_columns = null`; 7 tablas presentes; `pg_input_is_valid` disponible; `recalcularcomisiondespacho_238b_present = true`; `cod_summary_present = false`; `cod_reconciliation_present = false`; `idempotency_table_present = false`.

**✅ EJECUTADO 2026-10-18 vía conector Supabase (cuenta `supabase_decade-andre`, proyecto `listopos cotización` / ref `oyfyuszgjwcepjpngclv`, PostgreSQL 17.6, usuario `supabase_read_only_user`, solo lectura):** resultado **idéntico a la línea base** — `missing_columns=null`, 7 tablas presentes, `pg_input_is_valid` disponible, `recalcularcomisiondespacho_238b_present=true`, `cod_summary_present=false`, `cod_reconciliation_present=false`, `idempotency_table_present=false`, `migration_history_table_present=true`. La identidad del proyecto queda confirmada por la coincidencia exacta con el preflight del runbook del 2026-10-05.

**NO-GO** si falta cualquier columna, si las funciones COD ya existen, o si cambió cualquier resultado con respecto a la línea base. Escalar al DBA.

---

## 6. GATE — Backup restaurable (obligatorio antes de Tarea 2)

Idéntico al plan original **corregido**: backup completo (datos financieros, `auditoria`, `cod_conciliacion_idempotencia` si existiera), restore probado en ambiente descartable, hash/evidencia registrados. Además, según runbook Fase 3: ensayar **forward y reversión** en el disposable y verificar la firma/cuerpo real de `recalcularcomisiondespacho_238b` (el harness usa stub de comisión y **no** valida el importe final).

**✅ CUMPLIDO 2026-10-18** — Respaldo completo + prueba de restauración con PASS:
- **Método:** respaldo lógico vía Management API (HTTPS) con los scripts nuevos reutilizables `scripts/backup-supabase-logical.mjs` (esquema DDL + datos + huellas) y `scripts/verify-logical-backup.mjs` (clúster PostgreSQL desechable → restaura → compara conteos). `pg_dump` directo resultó imposible desde esta red: el host directo `db.oyfyuszgjwcepjpngclv.supabase.co` es **solo IPv6** (sin ruta IPv6 en la PC) y el pooler no reconoce el proyecto (sin tenant Supavisor).
- **Contenido:** 84 tablas · 58,579 filas · esquema completo (tablas, ENUMs, dominios, secuencias, constraints, índices, vistas, funciones incluidas las RPC, triggers, RLS) en `C:UsersluiggDesktopconstruacero-backups6-10-18`.
- **Huella SHA-256** registrada en `evidencia.txt` y `manifiesto.json` junto con conteos por tabla.
- **Prueba de restauración: PASS** — 38/38 tablas públicas restauradas con conteo exacto (incluidas `cuentas_por_cobrar`, `notas_despacho`, `comisiones`, `auditoria`, `clientes`, `usuarios`). 82/84 en total; las 2 no restauradas localmente son internas de Supabase con **0 filas** (`realtime.subscription`, `vault.secrets`) por tipos/fuciones exclusivas de la nube (pgvector, supabase_vault) — documentado, no bloqueante.
- Notas técnicas de la prueba local: la columna `vector(768)` de `productos` se restaura como `bytea` en la prueba (pgvector solo existe en la nube; el dato queda fiel en el respaldo) y la carga usa `session_replication_role = replica` (como `pg_restore`), con la integridad de FK garantizada por producción.
- Además, según runbook Fase 3: queda pendiente ensayar **forward y reversión** de la migración 14 en el disposable (con `verify:cod:release-local`, aparte de este respaldo).

---

## 7. Tarea 2 — Apply SQL en Producción

1. Crear copia de trabajo de `14_cod_financial_rpcs_review.sql` y eliminar **únicamente** el bloque `DO $review_gate$ … $review_gate$;` (líneas 15–19). No tocar el archivo fuente.
2. Ejecutar la copia en el SQL Editor de Supabase (rol `postgres`) o `psql` manual. **NUNCA** `supabase db push` / `db reset` / `migration repair` (deriva histórica confirmada; ver runbook "Bloqueo de historial").
3. El archivo es una transacción única `BEGIN…COMMIT` con su propio preflight interno (lanza `PRECONDICION_*` y aborta todo si algo no cuadra) y termina con `NOTIFY pgrst,'reload schema'`.

**Orden interno verificado:** tabla de idempotencia (PK `(cuenta_id, idempotency_key)`, RLS ON, `REVOKE ALL` incluido `service_role`) → `resumen_financiero_despacho` → `registrar_pago_externo_cobro_idempotente` → grants solo a `service_role` → `COMMENT` de propietario (usado por los guards del rollback).

**✅ PREPARADO 2026-10-18 (paso 1 de la Tarea 2):** copia de trabajo creada en `supabase/release/main/14_cod_financial_rpcs_apply.sql` eliminando **únicamente** el bloque `DO $review_gate$ … $review_gate$;` (líneas 15–19), con la misma transformación exacta que aplica `scripts/test-cod-main-release-local.mjs`. Consecuencia verificable: los bytes de esta copia son **exactamente** el contenido que el ensayo `verify:cod:release-local` aplicó con PASS el 2026-10-18 en PostgreSQL 17 desechable, es decir, la copia ya está probada de extremo a extremo salvo el paso 2 (aplicación en producción).

- SHA-256 fuente `14_cod_financial_rpcs_review.sql`: `7c9d75f1b20c3aa447cd5cc513fe9265023b0c714ef2e797e74d5a2d89d7899a` (intacto, verificado antes/después)
- SHA-256 copia `14_cod_financial_rpcs_apply.sql`: `4e4a2e09083b67ab30ad6b609028ccdaf000ab906125a52f083f483d700b760e`
- Verificación adicional: `npm run test:cod` 45/45 con la copia presente (el paquete de release la tolera).
- ~~Pendiente:~~ **paso 2 EJECUTADO 2026-10-18T21:07Z** (autorización explícita del owner).

**✅ EJECUTADO 2026-10-18 (Tarea 2 completa):** `14_cod_financial_rpcs_apply.sql` (SHA `4e4a2e09…3d700b760e`) aplicado en producción — proyecto **'listopos cotización'** / ref `oyfyuszgjwcepjpngclv`, PostgreSQL 17.6, vía conector Supabase (cuenta `supabase_idist-wese`). Pre-chequeo de identidad: `SUPABASE_GET_PROJECT` confirmó nombre/ref/versión y el catálogo mostró las 2 RPCs y la tabla ausentes (estado idéntico a la línea base del preflight). Resultado verificado en catálogo: `resumen_financiero_despacho(uuid,uuid)` presente (STABLE, SECURITY INVOKER), `registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)` presente (VOLATILE, SECURITY DEFINER) y `cod_conciliacion_idempotencia` con PK `(cuenta_id, idempotency_key)`, FK `despacho_id → notas_despacho(id) ON DELETE RESTRICT`, RLS ON y su comentario de propietario.

---

## 8. Tarea 3 — Postflight

Ejecutar `14_cod_postflight_readonly.sql`. Verifica firmas, volatilidad/definer, grants (`service_role` sí; `anon`/`authenticated` no), y por `pg_get_functiondef` que el cuerpo actualiza ambas columnas por separado, que la condición de cobro es `(v_deuda_cod-v_total_pago)<=0`, la tolerancia de $0.01, y el snapshot Bs (`tasa_snapshot`, `equivalente_usd`, `tasa_confirmada_en`, `v_pagos_snapshot`).

**Ampliación recomendada:** además del postflight, una llamada real de lectura con `service_role` a `resumen_financiero_despacho` sobre un despacho existente (la función es `SECURITY INVOKER` y depende de grants sobre las tablas, que el postflight no ejercita).

**✅ EJECUTADO 2026-10-18 (Tarea 3 completa):** `14_cod_postflight_readonly.sql` ejecutado contra producción → **16/16 checks en `true`**: presencia de ambas funciones y la tabla; `service_role` puede ejecutar ambas y `anon`/`authenticated` no pueden; `summary` STABLE+INVOKER, `reconcile` VOLATILE+DEFINER; ambos JSON (`forma_pago` y `forma_pago_cliente`) se actualizan por separado; cierre de COD exige `(v_deuda_cod-v_total_pago)<=0`; tolerancia `v_total_pago>v_deuda_cod+0.01`; `excedente_usd` explícito; contrato de snapshot Bs (`tasa_snapshot`, `equivalente_usd`, `tasa_confirmada_en`, `v_pagos_snapshot`) presente; y comentario de propietario en la función. **Pendiente de la ampliación recomendada:** la llamada real de lectura con `service_role` a `resumen_financiero_despacho` no es posible desde el conector (expone usuario de solo lectura, no `service_role`); queda para el smoke del Worker (Tarea 5), donde se ejercitará vía PostgREST. **✅ AMPLIACIÓN CUMPLIDA 2026-10-18:** la lectura real con `service_role` a `resumen_financiero_despacho` se ejecutó vía PostgREST dentro del smoke de Tarea 5 (checks S0/P2/F3 en verde).

**NO-GO** si cualquier check falla. No improvisar correcciones en vivo.

---

## 9. Tarea 4 — Frontend (ya cubierta por la Tarea 0)

El reemplazo de `ConciliarCodModal.jsx` ocurre en la Tarea 0. Comportamiento verificado del modal nuevo:
- Al abrir: `POST /api/despachos/resumen-financiero` → saldo del ledger, estado derivado, botón solo habilitado para `pendiente|parcial`.
- Al confirmar: `POST /api/despachos/conciliar-cod` con `{ despachoId, idempotencyKey, pagos, evidencia }`; clave generada por apertura y conservada en reintentos.
- `Efectivo Bs`: snapshot por pago (monto Bs, tasa 8 decimales, fuente, timestamp); muestra equivalente USD con half-up.
- Elimina `useRegistrarAbono`, `supabase` directo, `/api/cxc/abono` y `/api/despachos/editar-pago`.
- Evidencia ≥ 4 caracteres; referencias ≥ 2 caracteres para métodos no-efectivo; máximo 2 decimales en montos.

---

## 10. Tarea 5 — Despliegue y Smoke (orden corregido)

1. Tareas 0–3 completadas y postflight OK.
2. **Deploy Worker (Cloudflare)** — confirmar el SHA desplegado corresponde a `api/handlers/cod.js` del repo (requisito del runbook Fase 0).
3. **Deploy Frontend (Vercel)** — solo después del Worker.
4. Smoke en producción (acotado, con fixtures limitados autorizados por el owner):
   1. Abrir un despacho COD **nuevo** (creado tras el deploy, o fixture autorizado por el owner) → el modal llama a `resumen-financiero` y muestra el saldo exacto del ledger. **No usar los casos históricos de §14 como sujetos de smoke** (el alcance no los incluye); solo se tocarían si el cliente real paga.
   2. Pago **parcial** → `estado_cod: 'parcial'`, deuda restante conservada, **sin** comisión.
   3. Pago final → `estado_cod: 'cobrado'`, `cobro_destino_pagado: true`, comisión recalculada **una vez**.
   4. Replay por `curl` con la misma clave y body idéntico → mismo resultado + `idempotent: true`, sin duplicar abonos.
   5. Misma clave con payload alterado → `COD_CONCILIACION_IDEMPOTENCIA_REUTILIZADA` (400).
   6. `Efectivo Bs` con tasa del momento → snapshot fijo en el abono y en `metodos_pagados`; reabrir el modal con otra tasa no revalúa el abono anterior.
   7. Verificar que ambos JSON conservan sus entradas no-COD y que CxC + `notas_despacho` + `auditoria` coinciden.

**✅ EJECUTADO 2026-10-18 (Tarea 5 — smoke end-to-end vía PostgREST):** `scripts/smoke-cod-prod-14.mjs` → **PASS (exit 0, 36/36 checks)** contra producción (`oyfyuszgjwcepjpngclv`, "listopos cotización") vía PostgREST con `service_role` — la misma capa que invoca el Worker; la clave se usó solo en memoria (nunca en archivos ni en el repo). Sujeto: fixture **SMOKE-14COD** en el **tenant E2E** (`983a7922-…`): cliente activo `14c0de00-…005`, cotización `…001` + item `…002` ($400), despacho `entregada` `…003` con COD $300 y cargo `…004`; actor `ef4044bf-…` (E2E Desarrollador Temporal). **No se tocaron los casos históricos de §14 ni el tenant real.** Checklist §10.4 completo: (1) resumen previo `pendiente`/deuda 300 ✓ · (2) pago parcial Zelle $100 (clave A) → `estado_cod:'parcial'`, restante 200, `comision_id:null`, 0 comisiones ✓ · (3) pago final (Efectivo Bs 4800.00 @ tasa 40.00000000 = $120 + Efectivo $ 80, clave B) → `cobrado`, `cobro_destino_pagado:true` en ambos JSON, **comisión recalculada UNA vez** (1 fila `generada`, $8.00 = 2% s/ $400, `calculo_version:'238b'`, `politica:'fecha_despacho_no_cxc'`) ✓ · (4) replay con **body byte-idéntico** (misma clave B) → mismo resultado + `idempotent:true`, sin duplicar abonos (3), sin re-calcular comisión (1), sin auditoría extra (2) ✓ · (5) misma clave con payload alterado → HTTP 400 `COD_CONCILIACION_IDEMPOTENCIA_REUTILIZADA`, sin efectos ✓ · (6) snapshot Bs fijo en el abono (`recibido=4800.00; tasa=40.00000000; equivalente_usd=120`) y en `metodos_pagados` (`tasa_snapshot`, `equivalente_usd`, `tasa_confirmada_en`); ninguna RPC acepta tasa como entrada → ninguna lectura posterior revalúa el abono ✓ · (7) ambos JSON conservan la entrada no-COD (`Efectivo 100`); CxC (1 cargo + 3 abonos) + `notas_despacho` + `auditoria` (2 filas `COD_CONCILIADO_CON_EVIDENCIA`) + `cod_conciliacion_idempotencia` (2 claves con `payload_hash` y `resultado`) todos cuadran ✓.

**Notas de ejecución:** (a) primera corrida 34/36 — los 2 rojos eran un bug de medición del harness (contaba las filas del ledger, incluido el cargo, contra el número de abonos; el estado real era el correcto: 3 abonos / 4 filas); corregido el harness y re-ejecutado el flujo completo desde baseline limpio → **36/36**; (b) el fixture atravesó las validaciones de dominio reales (`numero` GENERATED ALWAYS, `CLIENTE_INVALIDO`, `CLIENTE_SIN_CONTACTO`) — resuelto con cliente activo con contacto y numeración por identidad; (c) el fixture reconciliado queda en el tenant E2E como evidencia (IDs `14c0de00-…`), eliminable en cualquier momento si se prefiere no retenerlo.

---

## 11. Rollback (corregido)

- **`14_cod_rollback_review.sql`** (con gate REVIEW_ONLY propio): `DROP FUNCTION` de ambas RPC + `NOTIFY pgrst`. **Retiene** `cod_conciliacion_idempotencia` (historial financiero) y no borra ledger, JSON ni auditoría.
- **Sin tráfico real:** el owner puede aprobar el rollback comparando los `COMMENT` de propietario con los esperados (guards `ROLLBACK_14_COD_*_OWNER_MISMATCH`). No hay "cuerpos previos" que restaurar: las funciones no existían antes de este release.
- **Con tráfico real:** retirar la RPC no revierte pagos ya registrados. Evaluar compatibilidad del Worker, no borrar tablas/ledger/auditoría, y escalar a reconciliación financiera (seguir `docs/runbooks/rollback-base-de-datos.md`).
- No ejecutar el rollback "para probarlo" en una base compartida.

---

**✅ ENSAYADO 2026-10-18 (rollback completo):** `npm run verify:cod:rollback-local` → **PASS (exit 0, 13/13 checks)** en PostgreSQL 17.0011 desechable (loopback, sin red). Secuencia ensayada: (1) SHA del paquete aplicable verificado contra el registrado en §7; (2) apply sobre el mismo fixture de esquema del ensayo forward; (3) siembra de historial financiero (abono CxC, fila de auditoría, fila de `cod_conciliacion_idempotencia`); (4) **guards**: con el comentario de propietario alterado el rollback se niega (`ROLLBACK_14_COD_SUMMARY_OWNER_MISMATCH` / `ROLLBACK_14_COD_RECONCILE_OWNER_MISMATCH`) y no retira ninguna función; (5) **rollback real**: ambas funciones retiradas, historial financiero **retenido** (fila de idempotencia intacta, abonos del ledger y auditoría sin tocar, RLS activo en la tabla retenida) y `recalcularcomisiondespacho_238b` sin cambios; (6) **rollback re-ejecutable** (segunda corrida sin errores). Script nuevo: `scripts/test-cod-rollback-local.mjs` (npm: `verify:cod:rollback-local`).

## 12. Gates pendientes reales (NO-GO hasta completarlos)

1. ~~Firmas independientes del [paquete de revisión](../runbooks/cod-release-14-review-packet.md)~~ **OMITIDO por decisión del owner (2026-10-18):** el owner es el único decisor y no requiere firmas. El review packet queda como documentación de referencia, no como gate.
2. ~~Comparación del fingerprint/cuerpo de `recalcularcomisiondespacho_238b` vivo contra el artefacto aprobado del release 07.~~ **CERRADO 2026-10-18:** el cuerpo vivo coincide **línea por línea** con el artefacto de `07_comision_split_designado_v3_review.sql`; única diferencia: finales de línea CRLF (archivo) vs LF (base). Fingerprint vivo y cadena de comisiones registrados en §14.
3. Revisión DBA del historial de migraciones (deriva conocida) y definición del método manual auditable de apply.
4. SHA de Worker aprobado para el cutover coordinado — **simplificado:** basta que el owner confirme por escrito el SHA (huella) exacto probado al cerrar la Tarea 0; si el código cambia después, se re-prueba y se confirma el nuevo SHA.
5. ~~Backup restaurable + ensayo forward/rollback en disposable.~~ **CERRADO 2026-10-18:** backup restaurable probado (prueba de restauración PASS el 2026-10-18) + ensayo forward (`verify:cod:release-local` PASS) + ensayo de rollback (`verify:cod:rollback-local` PASS, 13/13 checks, incluidos los guards `ROLLBACK_14_COD_*_OWNER_MISMATCH` y la retención del historial financiero).
6. Repetir `test:cod` / `test:cod:browser` / `verify:cod:release-local` / `npm test` / `npm run build` sobre el SHA exacto aprobado.

---

## 13. Riesgos residuales conocidos

- ~~Fallback de `idempotencyKey` en el Worker~~ **CERRADO 2026-10-18:** `cod.js` exige la `Idempotency-Key` (body o header, 400 si falta) sin generar claves aleatorias (ver §2.5). De paso, el flujo legacy `/api/cxc/abono` ganó un guard anti-replay con clave (cubre a `TesterFlowView` mientras migra).
- **`TesterFlowView.jsx`** usa el flujo legacy `/api/cxc/abono` para pruebas COD; quedará desalineado con el flujo atómico.
- **Endpoint legacy `/api/despachos/editar-pago`** con `conciliado_sin_abono` sigue vivo (neutralizado: el resumen lo deriva a `manual_review`). Planear su deprecación.
- **Archivos duplicados del plan:** `PLAN_SOLUCION_DEFINITIVA_COD.md` (raíz) y `docs/plans/2026-10-18-solucion-definitiva-conciliacion-cod.md` quedan como histórico; este documento es la única fuente de ejecución.

---

## 14. Anexo — Verificación en vivo de la base de datos (2026-10-18, conector Supabase)

Todo ejecutado **en solo lectura** (usuario `supabase_read_only_user`); ningún estado modificado.

**Identidad del proyecto:** `listopos cotización` · ref `oyfyuszgjwcepjpngclv` · PostgreSQL 17.6 · `ACTIVE_HEALTHY` (coincide con la línea base del runbook).

**Cadena de comisiones viva y coherente con lo que invocará la RPC atómica:**

| Función | Fingerprint (md5 de `prosrc`) | Bytes | Notas |
|---|---|---|---|
| `recalcularcomisiondespacho_238b(uuid)` | `69b91386f312bb093a1738254f9bed3f` | 1203 | Wrapper: lock → guarda legacy → guarda G3 (pagadas intactas) → `DELETE` + `calcularcomisiondespacho_238b`. **Idéntico al artefacto release 07 salvo CRLF/LF.** Owner `postgres`, `SECURITY DEFINER`, `VOLATILE`, ACL `postgres=X | service_role=X` (`anon`/`authenticated` sin EXECUTE). |
| `calcularcomisiondespacho_238b(uuid)` | `92fe24f4cbc3e7326b0ab3c48a274d4e` | 22628 | Motor de cálculo multi-fila **con split designado** (`comision_designacion_diaria`), sin `requires_manual_review`. |
| `calcularcomisiondespacho(uuid)` | `d91a459d0f07b5a2b8cfadb7e4f329f6` | 72 | Delegador (release 10). |

**Historial de migraciones:** `supabase_migrations.schema_migrations` presente pero con **1 sola fila** y 0 coincidencias COD/14 — confirma la deriva histórica del runbook y la prohibición de `supabase db push/reset/repair`.

**Estado COD real (candidatos para smoke y posibles casos tipo #3991):** 70 notas `entregada` con `Cobro a destino` — 63 saldadas, **4 con deuda COD pendiente** y 3 sin cargo COD en el ledger (quedarán en `manual_review`):

| Despacho | Cargo COD | Deuda COD |
|---|---|---|
| #1284 | $4,503.40 | $4,503.40 |
| #2020 | $1,104.72 | $1,104.72 |
| #2185 | $3,135.96 | $2,820.96 (pago parcial previo) |
| #3879 | $490.00 | $490.00 |

**Pendiente ~$8,919.30 — CONGELADO por decisión de alcance:** estos casos (y los 3 `manual_review`) **no se concilian ni regularizan** salvo necesidad completa. Solo se atenderían si el cliente efectivamente paga su deuda, y entonces el flujo atómico nuevo los concilia de forma segura como cualquier COD. **No son sujetos del smoke test.** El release 14 es preventivo: su éxito se mide porque ningún COD nuevo vuelva a generar desfasaje CxC ↔ despacho.
