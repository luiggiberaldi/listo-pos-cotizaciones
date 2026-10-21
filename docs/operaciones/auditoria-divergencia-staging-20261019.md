# Auditoría de divergencia raíz ↔ construacero-staging (2026-10-19)

**Objeto:** clasificar las **203 divergencias** entre el árbol raíz (app de producción) y `construacero-staging/` (fork con vida propia) en **herramientas de staging (HT)**, **features reales (FR)** y **drift accidental (DA)**, con recomendación por archivo.

**Método:** listado git de ambos árboles, diff normalizado (ignorando CRLF) y extracción de símbolos/exports lado-específicos por archivo; cotejo de migraciones contra `supabase/release/main/`; fechas de último commit por lado.

**Composición:** 78 solo-staging + 122 comunes con contenido distinto + 3 eliminados-en-raíz (presentes solo en staging) = **203**.

**Claves de recomendación:**
| Código | Significado |
|---|---|
| **PROMOVER** | Pasar al codebase único (raíz) como feature/código de producción |
| **DEV-ONLY** | Mantener en el codebase único pero detrás de flag/dev (nunca en runtime de producción) |
| **RECONCILIAR** | Merge manual de ambos lados (ambos tienen cambios válidos) |
| **DESCARTAR** | No promover; retirar del árbol staging en la fusión |
| **ARCHIVAR** | Evidencia histórica/artefacto; conservar fuera del runtime (p. ej. `docs/history/`) |

---

## 0. Resumen ejecutivo

1. **La raíz es la línea viva**: commits recientes 2026-10-19 vs. staging estancado desde ~2026-08-28 salvo usos puntuales. Casi todo el drift "pequeño" se resuelve tomando la versión raíz.
2. **Tres divergencias estructurales** (no son drift): (a) el **modelo de auth** — staging tiene PIN PBKDF2 + caché de operadores, raíz tiene multi-cuenta + `operatorSession` + `isSameOriginRequest`; (b) **comisiones** — staging desarrolló un modelo v2 (liberar/retener, breakdown) local; (c) **dashboard/reportes** — staging +854 líneas propias en `DashboardView`.
3. **La serie de migraciones está BIFURCADA**: el mismo número identifica contenido distinto (raíz `235_comision_flete_fuera_carabobo` = staging `236_…`; staging `235_comision_descuento_manual` no existe en raíz). Nada debe validarse por número, solo por contenido/hash.
4. **El concepto "stock comprometido" quedó obsoleto en staging** con el release 17 (egreso al aprobar): 10+ archivos staging portan `comprometido`/`disponibleReal`/`notifyCompromisoAlto` que la raíz ya retiró.
5. Recomendación global: **fusión a un solo codebase con staging como entorno** (ver plan de fusión), pero **no bloquear el cutover del release 17** con esto.

---

## A. Solo-staging (78 archivos)

### A1. Herramientas de staging — DEV-ONLY (18)

| Archivo | Cat | Recomendación |
|---|---|---|
| `scripts/test-e2e-staging.mjs` | HT | **DEV-ONLY** — runner E2E (75 pasos/123 checks); pieza clave, conservar |
| `scripts/provision-staging-e2e.mjs` | HT | **DEV-ONLY** — provisión de cuenta E2E |
| `scripts/audit-kardex-staging.mjs` | HT | **DEV-ONLY** — auditoría de kardex |
| `scripts/monitor-kardex-staging.mjs` | HT | **DEV-ONLY** — monitor continuo de kardex |
| `scripts/reconcile-kardex-staging.mjs` | HT | **DEV-ONLY** — reconciliación de kardex |
| `scripts/detect-double-credit-cxc-staging.mjs` | HT | **DEV-ONLY** — detector de doble crédito CxC |
| `scripts/test-cod-sin-abono-staging.mjs` | HT | **DEV-ONLY** — prueba COD sin abono |
| `scripts/test-consumo-credito-staging.mjs` | HT | **DEV-ONLY** — prueba consumo de crédito |
| `scripts/test-revertir-movimiento-staging.mjs` | HT | **DEV-ONLY** — prueba reversa de inventario |
| `scripts/build-274.mjs` | HT | **DESCARTAR** — one-off de la migración 274 ya cerrada |
| `scripts/verify-diff-274.mjs` | HT | **DESCARTAR** — ídem |
| `scripts/test-consumo-tipo-274.mjs` | HT | **DESCARTAR** (o archivar con 274) |
| `scripts/test-saldo-favor-272.mjs` | HT | **DESCARTAR** (o archivar con 272) |
| `configure-local-worker.js` | HT | **DEV-ONLY** — configurador de Worker local staging |
| `.env.e2e.example` | HT | **DEV-ONLY** — plantilla de secretos E2E |
| `.dev.vars.example` | HT | **DEV-ONLY** — plantilla de secretos Worker |
| `api/lib/__tests__/e2eRunnerConfig.test.js` | HT | **DEV-ONLY** — test del runner |
| `src/utils/testerStockContract.js` | HT | **DEV-ONLY** — contrato de stock tester; **reescribir** tras release 17 (aserciones de comprometido) |

### A2. Features reales — decisión de producto (6)

| Archivo | Cat | Recomendación |
|---|---|---|
| `api/lib/comisionUtils.js` | FR | **PROMOVER** si se conserva el modelo de comisiones staging (ver §C2); si gana el modelo de `release/main`, **DESCARTAR** |
| `api/lib/descuentoUtils.js` | FR | **PROMOVER** — descuento manual (respaldado por migración `235_comision_descuento_manual`, sin contraparte en raíz) |
| `api/lib/fechaEntrega.js` | FR | **PROMOVER** — feature "fecha de entrega editable/efectiva" (migraciones 241/242); usada por reportes y despachos |
| `src/components/despachos/EditarFechaEntregaModal.jsx` | FR | **PROMOVER** junto a `fechaEntrega.js` (rol `ROLES_CAMBIO_FECHA_ENTREGA` en el handler staging) |
| `api/lib/__tests__/kardexAudit.test.js` | FR | **PROMOVER** — test de auditoría de kardex útil en ambos entornos |
| `docs/plans/PLAN_SALIDA_PRODUCCION.md` | FR | **ARCHIVAR** — documento de plan histórico |

### A3. Migraciones solo-staging (47) — ⚠️ serie bifurcada

Regla: **validar por contenido, nunca por número** (mismo número = contenido distinto entre árboles).

**A3.1 Contrapartes staging de releases ya promovidos a producción (18) — ARCHIVAR** como log de aplicación local (el artefacto canónico es `supabase/release/main/`):

| Migración | Contraparte release/main |
|---|---|
| `244_atomic_inventory_operations_staging` | `02_inventory_atomic_operations` |
| `246_staging_kardex_provenance_batch_reconciliation` | `05b_kardex_reconciliation` |
| `250_staging_kardex_provenance_backfill` | `01_kardex_provenance` (backfill) |
| `248_staging_inventory_guardrails` | `05_inventory_guardrails_and_reconciliation` |
| `251_staging_p0_financial_idempotency` | `04_idempotency_wrappers` |
| `252_staging_devolucion_cobro_diferencia` | `12_saldo_favor_consumo` / `registrar_cobro_diferencia_devolucion` |
| `253_staging_service_role_grants` | `06a_security_grants_safe` |
| `257_staging_comision_split_cliente_ajeno` | `07_comision_split_designado_v3` |
| `260_staging_comision_split_designado` | `07_comision_split_designado_v3` |
| `267_staging_split_v31_cliente_propio` | `07_comision_split_designado_v3` (v3.1) |
| `268_staging_bloqueo_stock_aprobacion` | `08_bloqueo_stock_aprobacion_review` |
| `269_staging_advertir_no_bloquear` | `08b_advertir_no_bloquear_review` |
| `270_staging_comision_cod_solo_pagado` | `09_comision_cod_solo_pagado_review` |
| `271_staging_notas_titulo` | `11_notas_titulo_review` |
| `264_staging_reversion_con_devoluciones` | `03_return_finance_atomic` (cotejo) |
| `247_staging_kardex_idempotency_rollback` | rollback de 246 — ARCHIVAR |
| `229_despacho_items_snapshots` / `230_despacho_items_origen` | columnas ya vivas en producción (`nombre_snap`, `origen`, `es_prestamo` verificadas en smoke) — ARCHIVAR, confirmar vía de aplicación |

**A3.2 Fixes staging SIN contraparte promovida (16) — COTEJADOS CONTRA PRODUCCIÓN (2026-10-20)**

> **Veredicto:** de los 15 fixes reales (256 es herramienta DEV-ONLY), **14 ya están en producción**
> (el cotejo vivo contra el proyecto `oyfyuszgjwcepjpngclv` lo confirma función por función) y
> **solo 1 falta realmente: `259` (parcial)**. Evidencia: `tmp/cotejo_final.txt`, `tmp/cotejo_cierre.txt`,
> cuerpos vivos volcados en `tmp/prod_bodies/` (md5 + diffs contra el linaje staging).

| Migración | Tema | Veredicto vs producción | Recomendación |
|---|---|---|---|
| `245_fix_staging_return_commission_base` | base de comisión en devoluciones | **PRESENTE** — `_atomica` viva es byte-idéntica al linaje staging post-272; `v_base_nueva` en `_neta` (ambos mundos) | cerrado |
| `249_staging_fix_lote_idempotency` | idempotencia de lote | **PRESENTE** — `etiquetar_lote_inventario` con `p_idempotency_key` + guarda idempotente | cerrado |
| `254_staging_comisiones_supervisor_select` | SELECT de supervisor | **PRESENTE (equivalente)** — la política nombrada `comisiones_supervision_select` NO existe, pero `dashboard_scope_select`/`can_read_seller` ya dan lectura a supervisor/jefe/administración (acotada a la cuenta propia; la política staging era global al rol) | cerrado (diferencia de alcance a decidir si importa) |
| `255_staging_fix_idempotencia_inventario` | idempotencia inventario | **PRESENTE** — `p_idempotency_key` en `aplicar_movimiento`/`transformar`/`devolver_prestamo` `_atomico` | cerrado |
| `256_staging_fix_tester_cleanup_cotizacion` | limpieza tester | **DEV-ONLY** — ⚠️ `tester_cleanup_cotizacion` **existe en producción** (herramienta tester colada; candidata a DROP) | limpieza |
| `258_staging_consumo_credito_cxc` | consumo crédito CxC | **PRESENTE** — trigger `trg_recalcular_saldo_pendiente` con `consumo_credito` + CHECK constraint en `cuentas_por_cobrar` | cerrado |
| `259_staging_fix_reporte_ventas_corte_y_cuenta` | reporte ventas | **FALTA (parcial)** — las RPCs vivas NO restan `corte_usd` de `venta_neta_usd` ni filtran por cuenta (solo está la exclusión de filas `es_corte`). La columna `corte_usd` existe en `notas_despacho`, así que el fix aplica. Raíz `240_fix_reporte_ventas_corte_y_cuenta` tiene el contenido completo | **PROMOVER (único fix real faltante)** |
| `261_staging_alias_devolucion_idempotente` | alias devolución | **PRESENTE** — `registrar_devolucion_parcial_cobro_idempotente` existe con `destino_saldo` | cerrado |
| `262_staging_devolucion_reembolso_atomico` | reembolso atómico | **PRESENTE** — `destino_saldo`/`reembolso` en `_atomica`; columnas `destino_saldo,reembolso_metodo,reembolso_monto,reembolso_referencia` en `despacho_devoluciones`; `_neta` viva incluso tiene rutas de reembolso que el staging 272 no | cerrado |
| `263_staging_fix_ajustar_finanzas_multi_fila` | ajuste multi-fila | **PRESENTE** — `FOR v_comision IN` en `_atomica` viva | cerrado |
| `265_staging_designado_no_externo` | designado ≠ externo | **PRESENTE** — `validar_designacion_diaria` con `es_externo` + `DESIGNADO_INVALIDO` | cerrado |
| `266_staging_tz_caracas_comisiones` | timezone Caracas | **PRESENTE** — `America/Caracas` en `calcularcomisiondespacho_238b` | cerrado |
| `272_staging_fix_saldo_favor_consumo` | saldo a favor | **PRESENTE** — `consumo_credito` en `confirmar_entrega_finanzas_idempotente` y `_atomica` | cerrado |
| `273_staging_entrega_sin_duplicar_saldo_favor` | doble saldo a favor | **PRESENTE** — el guard vivo ya es `c.tipo IN ('abono', 'consumo_credito')` (el cuerpo staging 272 aún tiene `= 'abono'`: producción incluye el fix) | cerrado |
| `274_staging_entrega_consumo_tipo_correcto` | tipo de consumo | **PRESENTE** — insert vivo con `'consumo_credito'` y referencia `p_despacho_id` | cerrado |
| `275_staging_revertir_movimiento_inventario` | reversa de inventario | **PRESENTE** — `revertir_movimiento_inventario_atomico` viva con `motivo_tipo` + `p_idempotency_key` | trackear raíz `275_…` |

**Impacto de lo único que falta (259):**

- **Inventario: NULO.** El fix solo toca RPCs de reporte (`obtener_reporte_ventas_operaciones/_comisiones`);
  no toca movimientos, lotes ni stock.
- **Comisiones / reportes: MODERADO.** `venta_neta_usd` (y `total_bs`, y el fallback de `forma_pago`)
  se **sobredeclaran por el monto del corte** cuando existe: `total_usd` incluye flete + corte y solo se
  resta flete. Las comisiones calculadas por `calcularcomisiondespacho_238b` NO se afectan (van por
  otra ruta), pero cualquier liquidación o conciliación que consuma estos reportes parte de una base
  inflada. Además, sin filtro por cuenta las RPCs mezclan ventas de otros negocios si el proyecto
  tiene más de una cuenta (fuga de datos entre tenants), y `asesor_id` toma `nd.vendedor_id` sin el
  `COALESCE(cl.vendedor_id, …)` del fix.
- **Excepción conocida (no es regresión):** `obtener_reporte_ventas_comisiones` ya excluye filas
  `es_corte` (nombre que empieza con "corte") — esa mitad del fix sí está; faltan la resta de
  `corte_usd` y el aislamiento por cuenta.

**Método del cotejo (solo lectura, Management API con el PAT del `.env`):** marcadores por función
(`v_base_nueva`, `FOR v_comision IN`, `destino_saldo`, `consumo_credito`, `p_idempotency_key`,
`America/Caracas`, `es_externo`, …) + estructura (políticas RLS, triggers, constraints, columnas) +
diff de cuerpos vivos (`pg_get_functiondef`/`prosrc`) de producción contra el linaje staging
(`272_staging_fix_saldo_favor_consumo.sql`, `259_staging_fix_reporte_ventas_corte_y_cuenta.sql`).
`confirmar_entrega_finanzas_idempotente` es idéntica byte a byte entre ambos mundos (md5 `73f96c09…`);
`_atomica` es idéntica salvo un salto de línea inicial.

**A3.3 Features de esquema solo-staging (9) — decisión de producto:**

| Migración | Tema | Recomendación |
|---|---|---|
| `227_roles_completos_staging` | catálogo de roles | **PROMOVER** si el modelo de roles staging es el vigente; si no, DESCARTAR |
| `235_comision_descuento_manual` | descuento manual comisión | **PROMOVER** (respalda `descuentoUtils.js`) |
| `236_comision_flete_fuera_carabobo` | comisión flete fuera de Carabobo | **PROMOVER** — existe en raíz como `235_…` (¡números distintos!); unificar por contenido |
| `238_sync_shared_schema` | resync de esquema | **DESCARTAR** (utilidad de un momento) |
| `239_align_embeddings_to_model` | embeddings | **DESCARTAR** (o DEV-ONLY si hay búsqueda semántica en uso) |
| `240_sync_sequences_after_restore` | secuencias post-restore | **DEV-ONLY** (rutina operativa) |
| `241_cambio_fecha_entrega_despacho` | fecha de entrega | **PROMOVER** (con `fechaEntrega.js`) |
| `242_alinear_reportes_fecha_entrega_efectiva` | reportes por fecha efectiva | **PROMOVER** (con lo anterior) |
| `243_staging_config_stock_negativo_compat` | stock negativo compat | **PROMOVER** (paridad Venta Anticipada) |

**A3.4 Rollbacks (4) — ARCHIVAR:** `272_rollback.sql`, `274_rollback.sql`, `276_rollback.sql`, `264_staging_reversion_con_devoluciones_rollback.sql`.

### A4. Artefactos de release staging (7) — ARCHIVAR

Pre-imágenes de rollback de releases staging ya aplicados. Evidencia, no runtime. Recomendación **ARCHIVAR** para los 7:

| Archivo |
|---|
| `supabase/release/staging/272_backup_cuerpos/ajustar_finanzas_devolucion_atomica.sql` |
| `supabase/release/staging/272_backup_cuerpos/ajustar_finanzas_devolucion_neta.sql` |
| `supabase/release/staging/272_backup_cuerpos/confirmar_entrega_finanzas_atomica_staging.sql` |
| `supabase/release/staging/272_backup_cuerpos/confirmar_entrega_finanzas_idempotente.sql` |
| `supabase/release/staging/272_backup_cuerpos/registrar_cobro_diferencia_devolucion.sql` |
| `supabase/release/staging/274_backup_cuerpos/confirmar_entrega_finanzas_atomica_staging.live.sql` |
| `supabase/release/staging/274_backup_cuerpos/confirmar_entrega_finanzas_idempotente.live.sql` |

---

## B. Eliminados-en-raíz (3) — DESCARTAR en staging

La raíz los retiró con el release 17 (fin del stock comprometido); staging aún los porta:

| Archivo | Cat | Recomendación |
|---|---|---|
| `src/hooks/useStockComprometido.js` | FR (obsoleta) | **DESCARTAR** — concepto muerto con egreso-al-aprobar |
| `src/components/inventario/StockComprometidoDetalle.jsx` | FR (obsoleta) | **DESCARTAR** — ídem |
| `src/hooks/useReporteInventario.js` | FR (obsoleta) | **DESCARTAR** — sustituido en raíz (release 17) |

---

## C. Comunes divergentes (122) — por subsistema

Convención: `−/+` = líneas únicas de raíz/staging. "raíz" como recomendación por defecto cuando solo hay drift (la raíz es la línea viva).

### C1. Auth / sesión — ⚠️ CRÍTICO, RECONCILIAR (6)

| Archivo | −/+ | Señal | Cat | Recomendación |
|---|---|---|---|---|
| `src/store/useAuthStore.js` | 350/252 | stg: PIN PBKDF2, caché operadores · raíz: multi-cuenta, `AUTH_CACHE_VERSION` | FR | **RECONCILIAR** — decisión de producto: unificar modelo de auth (multi-cuenta raíz + PIN staging si ambos se usan) |
| `api/lib/auth.js` | 124/181 | stg: `SUPER_ADMIN_UUID`, cachés · raíz: `operatorSession`, tenant | FR | **RECONCILIAR** |
| `api/handlers/auth-operators.js` | 145/236 | stg: `isMasterPin`, `markup_pct_externo` · raíz: audit, session | FR | **RECONCILIAR** |
| `src/services/authFetch.js` | 35/70 | stg: reintentos/timeout · raíz: `operatorSession`, abort | FR | **RECONCILIAR** |
| `src/modules/auth/LoginPage.jsx` | 154/62 | raíz: multi-cuenta, PIN watchdog · stg: caché usuarios | FR | **RECONCILIAR** (base raíz) |
| `src/components/auth/LoginPinModal.jsx` | 83/11 | raíz: `watchdog`, `submissionId` | DA | **PROMOVER raíz** |

### C2. Comisiones / finanzas — RECONCILIAR (8)

| Archivo | −/+ | Señal | Cat | Recomendación |
|---|---|---|---|---|
| `api/handlers/comisiones.js` | 326/585 | stg: liberar/retener, breakdown, ROLES_* · raíz: split v3, factores | FR | **RECONCILIAR** con `release/main/07` como fuente de verdad de RPCs |
| `src/hooks/useComisiones.js` | 20/82 | stg: `useLiberarComisionCxc`, `useMarcarComisionPagada` | FR | **RECONCILIAR** |
| `src/components/reportes/TabLiquidacion.jsx` | 101/286 | stg: `KpiCard`, `handlePagar`, grupos asesor | FR | **RECONCILIAR** |
| `src/hooks/useReporteLiquidacion.js` | 22/43 | stg: fechas efectivas, totales pagado/pendiente | FR | **RECONCILIAR** |
| `src/services/pdf/comisionesPDF.js` | 50/38 | stg: desglose CxC/regular · raíz: extensión de nombres | DA | **RECONCILIAR** |
| `src/hooks/useReporteVentas.js` | 34/26 | stg: pagadas/pendientes · raíz: `paymentSplit`, `vendorCodigoMap` | FR | **RECONCILIAR** |
| `src/components/despachos/ConciliarCodModal.jsx` | 221/338 | stg: abonos/sin-abono · raíz: métodos de pago split | FR | **RECONCILIAR** |
| `src/hooks/useReporteVendedores.js` | 26/31 | raíz: `paymentSplit` | FR | **PROMOVER raíz** + cotejar stg |

### C3. Despachos / inventario — base raíz (release 17) (16)

| Archivo | −/+ | Señal | Cat | Recomendación |
|---|---|---|---|---|
| `api/handlers/despachos.js` | 525/826 | raíz: release 17 · stg: fecha entrega, flete | FR | **RECONCILIAR** (raíz + port de `fechaEntrega`/flete si se promueven) |
| `api/handlers/inventario.js` | 459/517 | raíz: kardex/metadatos/idempotencia · stg: batch ingest | FR | **RECONCILIAR** (base raíz) |
| `src/hooks/useDespachos.js` | 7/35 | stg: `comprometido`, batches | DA | **PROMOVER raíz** (release 17) |
| `src/hooks/useInventario.js` | 146/109 | raíz: idempotencia, refresco tras metadatos | FR | **PROMOVER raíz** |
| `src/hooks/useMovimientosInventario.js` | 12/8 | raíz: chunks por producto | DA | **PROMOVER raíz** |
| `src/hooks/useLineItems.js` | 89/9 | raíz: `esPrestamo`, `origen` (préstamos) | FR | **PROMOVER raíz** |
| `src/components/despachos/EditarItemsDespachoModal.jsx` | 174/31 | raíz: edición profunda v2 | FR | **PROMOVER raíz** |
| `src/components/ui/DetalleModal.jsx` | 48/21 | raíz: edición profunda | FR | **PROMOVER raíz** |
| `src/components/despachos/DespachoCard.jsx` | 37/22 | raíz: release 17 | DA | **PROMOVER raíz** |
| `src/components/inventario/ProductoForm.jsx` | 75/16 | raíz: metadatos + refresco | FR | **PROMOVER raíz** |
| `src/components/inventario/IngresoLoteHubModal.jsx` | 35/36 | stg: `idempotencyKeyRef` · raíz: `UNIT_WORDS` | DA | **RECONCILIAR** |
| `src/components/despachos/DevolucionParcialModal.jsx` | 20/20 | ambos cambiaron | DA | **RECONCILIAR** |
| `src/components/despachos/EditDespachoModal.jsx` | 5/5 | menor | DA | **PROMOVER raíz** |
| `src/components/inventario/ProductoCard.jsx` | 11/26 | stg: `disponible`, `sobrecomprometido` | FR (obsoleta) | **PROMOVER raíz** (retira comprometido) |
| `src/components/shared/ProductCard.jsx` | 16/10 | stg: `disponibleReal` | FR (obsoleta) | **PROMOVER raíz** |
| `src/components/cotizaciones/ProductoAutocomplete.jsx` | 6/7 | stg: `comprometido` | FR (obsoleta) | **PROMOVER raíz** |
| `src/views/ConfiguracionView.jsx` | 151/199 | stg: `FiscalTab`, `TransportistasTab`, config de flete | FR | **RECONCILIAR** (con features de flete de A3.3 y `descuentoUtils`) |
| `src/components/inventario/ListaPreciosModal.jsx` | 4/3 | menor | DA | **PROMOVER raíz** |
| `src/components/inventario/ProductoDetalleModal.jsx` | 3/2 | menor | DA | **PROMOVER raíz** |

### C4. Cotizaciones / venta — base raíz (7)

| Archivo | −/+ | Señal | Cat | Recomendación |
|---|---|---|---|---|
| `src/components/cotizaciones/CotizacionBuscador.jsx` | 2/7 | stg: `comprometido` | FR (obsoleta) | **PROMOVER raíz** |
| `src/components/cotizaciones/CotizacionBuilder.jsx` | 4/3 | menor | DA | **PROMOVER raíz** |
| `src/components/cotizaciones/CotizacionCard.jsx` | 5/4 | menor | DA | **PROMOVER raíz** |
| `src/hooks/useCotizaciones.js` | 5/8 | raíz: invalidaciones release 17 | DA | **PROMOVER raíz** |
| `src/hooks/useVentaRapida.js` | 2/3 | menor | DA | **PROMOVER raíz** |
| `api/handlers/cotizaciones.js` | 38/42 | raíz: `requestedSellerId` · stg: `transportistaFinalId` | FR | **RECONCILIAR** |
| `src/views/VentaRapidaView.jsx` | 33/25 | raíz: `fleteLocalRequiereEstado` | FR | **PROMOVER raíz** |

### C5. Dashboard / reportes — ⚠️ grande, RECONCILIAR (7)

| Archivo | −/+ | Señal | Cat | Recomendación |
|---|---|---|---|---|
| `src/views/DashboardView.jsx` | 132/854 | stg: KPIs, skeletons, métricas propias | FR | **RECONCILIAR** (mayor feature staging; decidir qué dashboard queda) |
| `src/hooks/useDashboardMetrics.js` | 37/222 | stg: métricas semanales/clientes | FR | **RECONCILIAR** |
| `src/hooks/useReporteDespachos.js` | 8/22 | stg: fecha efectiva | FR | **RECONCILIAR** (con fechaEntrega) |
| `src/hooks/useReportePipeline.js` | 1/1 | trivial | DA | **PROMOVER raíz** |
| `src/services/pdf/pdfShared.js` | 129/27 | raíz: header premium | FR | **PROMOVER raíz** |
| `src/services/pdf/pipelinePDF.js` | 10/1 | menor | DA | **PROMOVER raíz** |
| `src/services/pdf/reporteVendedoresPDF.js` | 48/19 | ambos cambiaron | DA | **RECONCILIAR** |

### C6. Roles / usuarios / clientes — base raíz (6)

| Archivo | −/+ | Señal | Cat | Recomendación |
|---|---|---|---|---|
| `api/handlers/admin.js` | 291/123 | stg: `secuencias`, `tiposRelacion` · raíz: transferencia de clientes, limpieza TEST_* | FR | **RECONCILIAR** (base raíz) |
| `api/handlers/clientes.js` | 109/213 | raíz: idempotencia, tenant, lotes · stg: préstamos | FR | **RECONCILIAR** (base raíz) |
| `src/views/UsuariosView.jsx` | 32/6 | raíz: `puedeReasignarClientes` | FR | **PROMOVER raíz** |
| `src/components/clientes/ClienteCard.jsx` | 3/1 | raíz: `puedeReasignar` | FR | **PROMOVER raíz** |
| `src/components/clientes/ClienteRow.jsx` | 4/2 | ídem | FR | **PROMOVER raíz** |
| `src/hooks/useClientes.js` | 2/2 | trivial | DA | **PROMOVER raíz** |

### C7. Notificaciones / recordatorios — ligado a release 17 (2)

| Archivo | −/+ | Señal | Cat | Recomendación |
|---|---|---|---|---|
| `src/services/notificationService.js` | 22/49 | stg: `notifyCompromisoAlto` | FR (obsoleta) | **PROMOVER raíz** + **DESCARTAR** avisos de compromiso |
| `src/hooks/useRecordatoriosCotizaciones.js` | 2/33 | stg: `COMPROMISO_UMBRAL`, `comprometidoMap` | FR (obsoleta) | **PROMOVER raíz** (sin comprometido) |

### C8. Infraestructura / configuración — drift, base raíz (18)

| Archivo | −/+ | Señal | Cat | Recomendación |
|---|---|---|---|---|
| `worker.js` | 56/42 | ambos activos 2026-10-16 | DA | **RECONCILIAR** (raíz + flags staging) |
| `api/lib/utils.js` | 12/3 | raíz: `isSameOriginRequest` (CSRF) | FR | **PROMOVER raíz** (seguridad) |
| `api/lib/audit.js` | 40/28 | raíz: `fetchWithTimeout` | DA | **PROMOVER raíz** |
| `api/lib/transportistaUtils.js` | 5/2 | trivial | DA | **PROMOVER raíz** |
| `api/handlers/proveedores.js` | 6/1 | trivial | DA | **PROMOVER raíz** |
| `api/handlers/transportistas.js` | 4/2 | trivial | DA | **PROMOVER raíz** |
| `api/handlers/cxc.js` | 39/6 | raíz: replay/idempotencia | DA | **PROMOVER raíz** |
| `src/services/apiBase.js` | 50/10 | raíz: timeouts, `operatorSession` | FR | **PROMOVER raíz** |
| `src/services/supabase/client.js` | 28/19 | raíz: timeouts · stg: refs de entorno | DA | **RECONCILIAR** |
| `src/services/supabase/adminClient.js` | 28/46 | ambos cambiaron | DA | **RECONCILIAR** |
| `src/hooks/useConfigNegocio.js` | 4/7 | menor | DA | **PROMOVER raíz** |
| `src/hooks/useRealtimeSync.js` | 10/6 | raíz: `DASHBOARD_KEY` | DA | **PROMOVER raíz** |
| `src/hooks/useScanMaterialList.js` | 2/3 | trivial | DA | **PROMOVER raíz** |
| `src/hooks/useTransportistas.js` | 16/24 | ambos cambiaron | DA | **RECONCILIAR** |
| `src/hooks/useUsuarios.js` | 3/3 | trivial | DA | **PROMOVER raíz** |
| `src/hooks/useCuentasCobrar.js` | 9/6 | menor | DA | **PROMOVER raíz** |
| `src/hooks/useMutationQueue.js` | 0/2 | trivial | DA | **PROMOVER raíz** |
| `src/lib/queryPersister.js` | 1/1 | trivial | DA | **PROMOVER raíz** |
| `src/sw.js` | 11/2 | service worker/PWA | DA | **PROMOVER raíz** |

### C9. UI / vistas menores — drift, base raíz (17)

| Archivo | −/+ | Recomendación |
|---|---|---|
| `src/App.jsx` | 13/4 | **PROMOVER raíz** |
| `src/main.jsx` | 6/2 | **PROMOVER raíz** |
| `src/views/ClientesView.jsx` | 4/6 | **PROMOVER raíz** |
| `src/views/ComisionesView.jsx` | 1/1 | **PROMOVER raíz** |
| `src/views/CotizacionesView.jsx` | 11/12 | **RECONCILIAR** |
| `src/views/DespachosView.jsx` | 65/52 | **PROMOVER raíz** (filtrado nuevo) |
| `src/views/InventarioView.jsx` | 0/4 | **PROMOVER raíz** |
| `src/views/ReporteVendedoresView.jsx` | 13/9 | **PROMOVER raíz** |
| `src/views/ReportesView.jsx` | 3/1 | **PROMOVER raíz** |
| `src/views/TransportistasView.jsx` | 3/3 | **PROMOVER raíz** |
| `src/views/TutorialView.jsx` | 3/3 | **PROMOVER raíz** |
| `src/components/layout/AppLayout.jsx` | 7/1 | **PROMOVER raíz** |
| `src/components/reportes/DateRangeSelector.jsx` | 8/7 | **PROMOVER raíz** |
| `src/components/reportes/TabTransportistas.jsx` | 3/3 | **PROMOVER raíz** |
| `src/components/ui/Toast.jsx` | 4/7 | **RECONCILIAR** (menor) |
| `src/components/ui/OfflineBanner.jsx` | 10/28 | **RECONCILIAR** (stg: `backendProjectRef`) |
| `src/components/ui/CustomSelect.jsx` | 1/0 | **PROMOVER raíz** |

### C10. Utilidades — drift trivial, base raíz (8)

| Archivo | −/+ | Recomendación |
|---|---|---|
| `src/utils/clienteSearch.js` | 1/1 | **PROMOVER raíz** |
| `src/utils/entitySearch.js` | 1/1 | **PROMOVER raíz** |
| `src/utils/smartSearch.js` | 0/2 | **PROMOVER raíz** |
| `src/utils/cotizacionActions.js` | 1/1 | **PROMOVER raíz** |
| `src/utils/estadoLabels.js` | 0/2 | **PROMOVER raíz** |
| `src/utils/format.js` | 2/3 | **PROMOVER raíz** |
| `src/utils/whatsapp.js` | 8/8 | **RECONCILIAR** (menor) |
| `src/constants/formasPago.js` | 5/0 | **PROMOVER raíz** (`getSalePaymentMethods`) |

### C11. Config raíz / build / docs (14)

| Archivo | −/+ | Recomendación |
|---|---|---|
| `package.json` | 31/21 | **PROMOVER raíz** (scripts/dep. vigentes) |
| `package-lock.json` | 298/7 | **PROMOVER raíz** (regenerar con el merge) |
| `vite.config.js` | 4/8 | **RECONCILIAR** |
| `vitest.config.js` | 10/0 | **PROMOVER raíz** |
| `eslint.config.js` | 1/1 | **PROMOVER raíz** |
| `wrangler.toml` | 9/8 | **RECONCILIAR** (vars por entorno → flags) |
| `wrangler.dev.jsonc` | 4/6 | **DEV-ONLY** (config local staging) |
| `worker.js` (ver C8) | — | — |
| `.github/workflows/deploy-worker.yml` | 29/2 | **PROMOVER raíz** (CI vigente) |
| `.gitignore` | 105/17 | **RECONCILIAR** (unión) |
| `.env.example` | 2/20 | **RECONCILIAR** (raíz + vars staging documentadas) |
| `.vercelignore` | 20/1 | **PROMOVER raíz** |
| `.supabase/project-ref` | 1/1 | **DEV-ONLY** (valor por entorno) |
| `README.md` | 13/167 | **RECONCILIAR** (migrar contenido útil del README staging al único) |
| `supabase/config.toml` | 1/1 | **PROMOVER raíz** |
| `docs/history/BITACORA.md` | 24/0 | **PROMOVER raíz** |
| `docs/plans/ROADMAP.md` | 15/0 | **PROMOVER raíz** |

### C12. Migraciones comunes divergentes (4) + E2E SQL (2)

| Archivo | −/+ | Señal | Recomendación |
|---|---|---|---|
| `supabase/migrations/206_transportistas_locales.sql` | 1/1 | trivial | **PROMOVER raíz** |
| `supabase/migrations/220_transportistas_clasificacion.sql` | 0/1 | trivial | **PROMOVER raíz** |
| `supabase/migrations/234_tester_cleanup_tenant_safe.sql` | 0/9 | herramienta tester | **DEV-ONLY** |
| `supabase/migrations/275_rollback.sql` | 3/3 | rollback 275 | **ARCHIVAR** |
| `supabase/staging/228_e2e_devolucion_staging.sql` | 20/21 | E2E devolución | **DEV-ONLY** (raíz ya porta T9 release 17) |
| `supabase/staging/README.md` | 3/5 | doc E2E | **DEV-ONLY** |

### C13. Tester — DEV-ONLY + reescritura (1)

| Archivo | −/+ | Señal | Recomendación |
|---|---|---|---|
| `src/views/TesterFlowView.jsx` | 224/309 | stg: pasos de compromiso (`stepAssertStockComprometido*`) | **DEV-ONLY** y **reescribir** asserts de comprometido por los del modelo release 17 |

---

## D. Conteo final por categoría y recomendación (orientativo; la clasificación por archivo es la de las tablas A–C)

| Categoría | Archivos | Recomendación dominante |
|---|---|---|
| Herramientas de staging (HT) | 24 | DEV-ONLY (20) / DESCARTAR (4) |
| Features reales (FR) | 85 | PROMOVER (~45) / RECONCILIAR (~33) / DESCARTAR (7 obsoletas por release 17) |
| Drift accidental (DA) | 94 | PROMOVER raíz (~70) / RECONCILIAR (~24) |
| **Total** | **203** | |

**Los 7 "DESCARTAR" por release 17** (concepto de stock comprometido): `useStockComprometido.js`, `StockComprometidoDetalle.jsx`, `useReporteInventario.js` (eliminados en raíz), y los símbolos `comprometido`/`disponibleReal`/`notifyCompromisoAlto`/`COMPROMISO_UMBRAL` dentro de `CotizacionBuscador`, `ProductoAutocomplete`, `ProductoCard`, `ProductCard`, `useDespachos`, `useRecordatoriosCotizaciones`, `notificationService`, `TesterFlowView`, `testerStockContract`.

---

## E. Orden de trabajo sugerido

1. **Antes del cutover de producción (release 17):** nada de esta auditoría bloquea; solo el port puntual de los ~20 archivos del release 17 al árbol staging si se quiere E2E del flujo nuevo.
2. ~~**Cotejo de A3.2**~~ — **HECHO (2026-10-20):** 14/15 fixes reales ya están en producción; solo falta `259` (reporte ventas: resta de `corte_usd` + filtro por cuenta), que **no toca inventario** y solo afecta la exactitud de los reportes de ventas/comisiones. Empaquetar `240_fix_reporte_ventas_corte_y_cuenta` (raíz) como release. Ver §A3.2.
3. **Decisión de producto** sobre las 3 divergencias estructurales: modelo de auth (C1), modelo de comisiones (C2), dashboard (C5), y las features staging A2/A3.3 (fecha de entrega, descuento manual, flete).
4. **Fusión de árboles** (proyecto aparte, 1-2 semanas): un codebase, staging como entorno; herramientas DEV-ONLY con flag; reset periódico de staging desde dump de producción (resuelve además la serie de migraciones bifurcada).
