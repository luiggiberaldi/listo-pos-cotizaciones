# Plan — Egreso de inventario al aprobar despacho (fin del stock comprometido)

**Fecha:** 2026-10-19 · **Estado:** PROPUESTO (auditoría incluida; pendiente de autorización y de las 2 decisiones del §4)
**Pedido:** al aprobar un despacho (pendiente→despachada), los productos deben **descontarse del inventario** en ese momento. Eliminar la lógica de "stock comprometido" (el chip "N comprometidas" de inventario).

**Veredicto de factibilidad: SÍ ES FACTIBLE.** El cambio es de semántica, no de arquitectura: mueve el punto de egreso de "al entregar" a "al aprobar" dentro de las mismas RPCs atómicas existentes. Además **corrige un bug latente de stock** (hallazgo 1.2). Riesgo principal: los despachos que queden "en vuelo" durante el cutover (§4.2).

---

## 1. Auditoría del flujo actual (evidencia por archivo/línea)

### 1.1 Modelo vigente: "compromiso al aprobar, egreso al entregar"

| Paso | Qué pasa hoy | Evidencia |
|---|---|---|
| Crear despacho (desde cotización o venta rápida) | Insert directo vía PostgREST, **sin efecto en stock**. Venta rápida crea su despacho en `pendiente` y pasa por el mismo ciclo | `api/handlers/despachos.js:228` (comentario: "stock se descuenta al confirmar entrega por logística"), `:235`, `:291`; `api/handlers/cotizaciones.js` (`handleVentaRapida`) |
| Aprobar (pendiente→despachada) | RPC `aprobar_despacho_inventario_atomico`: fija estado + devuelve `faltantes` como advertencia (v2 "advertir, nunca bloquear"). **No toca stock**. Si el toggle `bloqueo_stock_aprobacion` está OFF la RPC es no-op y el Worker hace un PATCH legacy | releases `08`/`08b` (principal), migraciones staging `268`/`269`; cuerpo vivo en `construacero-backups/2026-10-18/_esquema_local.sql:3887+`; Worker `api/handlers/despachos.js:922-960` |
| "Comprometido" | **Derivado, no almacenado**: `SUM(notas_despacho_items)` de despachos en estado `despachada` (regla 222: despachada = comprometido; entregada/pendiente/anulada = no). `disponible = físico − comprometido` | SQL `obtener_stock_comprometido` / `obtener_stock_comprometido_detalle` (dump `:10186+`) |
| Entregar (→entregada) | `confirmar_entrega_finanzas_idempotente` → llama internamente `confirmar_entrega_inventario_atomica`: **−`stock_actual` + kardex `egreso`** (motivo "Entrega confirmada — Despacho #N", `motivo_tipo venta`) + CxC + comisiones. Venta Anticipada (`permitir_stock_negativo`) permite negativo | dump `:5981+`; Worker `despachos.js:847-880` |
| Revertir entrega (entregada→despachada) | `revertir_entrega_finanzas_idempotente` → `revertir_entrega_inventario_atomica`: **+stock** (reingreso) | dump `:12151+`, `:12356+`; Worker `despachos.js:836-843` |
| Devolver a pendiente / anular (desde `despachada`) | Solo cambia estado; **sin efecto en stock** (coherente hoy: nunca se descontó) | Worker `despachos.js:672-675` (máquina de estados), ruta PATCH |
| Devolución parcial / intercambio (post-entrega) | `registrar_devolucion_parcial_cobro_idempotente` → `registrar_devolucion_inventario_atomica`: **+stock** por lo devuelto; los ítems de intercambio egresados se devuelven | dump `:11601+`; Worker `despachos.js:1010`, `:2491` |
| Préstamos / ítems externos | Excluidos del inventario (`origen='inventario'`, `es_prestamo`) | RPCs `aprobar_*` y `confirmar_entrega_*` (filtro `COALESCE(ndi.origen,'inventario')='inventario'`) |

### 1.2 Hallazgos de la auditoría

1. **⚠️ Bug latente — la edición profunda corrompe el stock.** `editar_despacho_profundidad` (ambos overloads, dump `:6898+`): paso 3 "devolver stock temporalmente" (+ítems viejos) y paso 5 "volver a descontar" (−ítems nuevos). Esa matemática asume *descuento desde la creación*, pero el flujo vivo descuenta al entregar → editar un despacho `pendiente`/`despachada` mueve stock que nunca se descontó, y la entrega descuenta de nuevo (doble efecto). Con el modelo propuesto (egreso al aprobar) la fórmula +viejos/−nuevos queda **exactamente correcta para `despachada`**; solo hay que no tocar stock en `pendiente`.
2. **Funciones huérfanas del modelo antiguo** ("descuento al crear"): `crear_nota_despacho` (descuenta + kardex) y `anular_despacho_atomico` (restituye) **no las llama nadie** (api/src/scripts). Conviene retirarlas para no confundir mantenimiento.
3. **La advertencia de faltantes es cosmética:** la RPC v2 solo informa `faltantes` y nunca rechaza. Con egreso real al aprobar, esta lógica se sustituye por una validación dura de stock (§4.1).
4. **Venta rápida no rompe el modelo:** su despacho nace `pendiente`; el egreso ocurriría al aprobar, igual que el resto.

---

## 2. Modelo propuesto (transición × efecto en inventario)

| Transición | Hoy | Propuesto |
|---|---|---|
| crear (→pendiente) | — | — |
| **aprobar (→despachada)** | — (queda "comprometido") | **−cantidad + kardex `egreso`** ("Despacho #N aprobado", `motivo_tipo venta`) |
| entregar (→entregada) | −cantidad + kardex | **—** (solo finanzas: CxC, comisiones) |
| revertir entrega (→despachada) | +cantidad | **—** (el egreso ya ocurrió al aprobar) |
| devolver a pendiente (despachada→pendiente) | — | **+cantidad + kardex `ingreso`** ("Despacho #N devuelto a pendiente") |
| anular (despachada→anulada) | — | **+cantidad + kardex `ingreso`** ("Anulación Despacho #N") |
| anular (pendiente→anulada) | — | — |
| editar items (pendiente) | ± (bug 1.2.1) | **—** (solo reemplaza ítems) |
| editar items (despachada) | ± (bug 1.2.1) | **± delta** (corregido por construcción) |
| devolución/intercambio (post-entrega) | +devuelto | igual |
| préstamos / externos | excluidos | igual |

**Desaparecen:** las RPCs `obtener_stock_comprometido(_detalle)`, el hook `useStockComprometido`, el componente `StockComprometidoDetalle` (chip "N comprometidas"), el cálculo `disponibleReal = físico − comprometido` y la advertencia `faltantes` al aprobar. El stock que ve la UI pasa a ser el **físico real** (ya descontado).

---

## 3. Alcance de cambios (por capas)

| # | Capa | Cambio |
|---|---|---|
| T1 | BD | **`aprobar_despacho_inventario_atomico` v3**: en una sola transacción (FOR UPDATE sobre despacho y productos): validar estado/tenant/cantidades → validar stock (§4.1) → `stock_actual −= cantidad` + insert `inventario_movimientos` (`egreso`, "Despacho #N aprobado", `motivo_tipo venta`, `lote_id`) → estado `despachada` + `despachada_en` + `aprobado_por_nombre` → auditoría. Se elimina el cálculo de `comprometido`/`faltantes`. Igual que hoy: agrupa por producto, excluye externos/préstamos, `SECURITY DEFINER`, grants solo `service_role`. **Siempre hace el egreso** (retira la ruta no-op del toggle `bloqueo_stock_aprobacion`). |
| T2 | BD | Entrega sin inventario: `confirmar_entrega_finanzas_idempotente` deja de llamar `confirmar_entrega_inventario_atomica` (o llama una variante que solo valida). `revertir_entrega_finanzas_idempotente`/`revertir_entrega_inventario_atomica` dejan de reingresar. Mismas firmas → rollout compatible. |
| T3 | BD | `editar_despacho_profundidad`: el ± de stock solo aplica cuando `estado='despachada'` (ya egresado); en `pendiente` solo reemplaza ítems sin tocar stock. Unificar los dos overloads en el paso de implementación. |
| T4 | BD | Reversión con reingreso: devolver a pendiente y anular **desde `despachada`** → `+cantidad` + kardex `ingreso` en la misma transacción del cambio de estado (nueva RPC o extensión de la de reversión; misma técnica de locks). |
| T5 | BD | Limpieza: retirar grants y marcar como obsoletas `obtener_stock_comprometido(_detalle)`, `crear_nota_despacho`, `anular_despacho_atomico` (DROP posterior coordinado, §4.3). |
| T6 | BD | **Backfill de cutover** (§4.2): para los despachos en `despachada` al momento de aplicar, −stock + kardex `egreso` con motivo marcado (`MIGRACIÓN — egreso por cambio de modelo #N`), idempotente y con backup previo. |
| T7 | Worker | `api/handlers/despachos.js`: la aprobación llama la RPC v3 y ya no consulta/maqueta `faltantes` (`:922-960`); mantener roles (2b), guardarrails y la respuesta al cliente. `handleEditarItemsDespacho` sin cambios de firma. |
| T8 | UI | Quitar comprometido: `src/hooks/useStockComprometido.js`, `src/components/inventario/StockComprometidoDetalle.jsx`, chip en `src/components/inventario/ProductoCard.jsx` (StockBadge), props `comprometido`/`disponibleReal` en `src/components/shared/ProductCard.jsx`, `src/views/InventarioView.jsx:479`, `src/components/cotizaciones/CotizacionBuscador.jsx:344-352`, invalidaciones `STOCK_COMPROMETIDO_KEY` (`useMutationQueue`, `useCotizaciones`, `useVentaRapida`, `useRecordatoriosCotizaciones`), panel de `faltantes` en `src/components/despachos/DespachoCard.jsx`, `src/hooks/useReporteInventario.js`. |
| T9 | Tests | Actualizar el e2e staging `supabase/staging/228_e2e_devolucion_staging.sql` (aserciones de compromiso 2→0); contratos de RPC (`src/utils/__tests__/rpcProductContract.test.js`); tests nuevos por transición (aprobar descuenta; entregar no descuenta; revertir entrega no reingresa; devolver a pendiente/anular reingresan; editar en pendiente no toca stock; editar en despachada ajusta delta). Suite completa + build. |

---

## 4. Decisiones requeridas (recomendación marcada)

1. **Stock insuficiente al aprobar:** **(Recomendado) rechazar** con `STOCK_INSUFICIENTE` salvo Venta Anticipada (`permitir_stock_negativo`) — paridad con el descuento de hoy al entregar. Alternativa: permitir negativo siempre (el modelo actual "nunca bloquea").
2. **Despachos en vuelo al cutover** (en `despachada`, comprometidos sin descontar): **(Recomendado) backfill** único (T6) para que exista una sola semántica desde el minuto 1. Alternativa: dejar que esos descontar al entregar (exige lógica dual temporal en T2 y un corte posterior).
3. **Destino de las RPCs retiradas:** (Recomendado) quitar grants ahora y DROP en limpieza posterior; nunca borrar en el mismo release que el cambio de semántica.

---

## 5. Verificación (acceptance criteria)

1. `npx vitest run` → suite completa verde (incluidos los tests nuevos de transiciones de T9).
2. `npx vite build` → exit 0.
3. Postflight SQL: la v3 de aprobación descuenta y deja kardex; `confirmar_entrega_inventario_atomica` ya no descuenta; permisos iguales a hoy (solo `service_role`).
4. **Smoke en producción** por transición, con un producto de prueba: aprobar → `stock_actual` baja y aparece el kardex `egreso`; entregar → sin nuevo descuento ni movimiento; revertir entrega → sin reingreso; devolver a pendiente y anular desde `despachada` → reingreso + kardex; editar en `pendiente` → stock intacto; venta rápida → egreso al aprobar; devolución post-entrega → reingresa lo devuelto. Verificar que el chip "N comprometidas" ya no existe en inventario, venta rápida ni cotizaciones.
5. Concurrencia: dos aprobaciones simultáneas de despachos con el mismo producto no duplican ni pierden egresos (locks `FOR UPDATE` de la v3).

## 6. Despliegue (orden obligatorio)

1. **GATE:** backup verificable de la BD (incluye `productos`, `inventario_movimientos`, `notas_despacho(_items)`) + restore probado — mismo criterio que el plan COD.
2. Apply SQL manual (SQL Editor / psql con `service_role`; **NO** `supabase db push` — deriva histórica de migraciones).
3. Backfill T6 (si la decisión 4.2 es backfill) con evidencia por despacho.
4. Desplegar Worker + frontend juntos (`./deploy.sh`; build + `wrangler deploy` con secrets de `.env.secrets`).
5. Smoke del §5.

## 7. Rollback

- **Sin tráfico nuevo:** revert de los cuerpos de funciones (guardar versiones previas al apply) + quitar el backfill con los `lote_id` de migración registrados (reingreso espejo). La tabla `inventario_movimientos` es evidencia: no se borra.
- **Con tráfico nuevo:** no revertir solo la BD; coordinar revert del commit de app + cuerpos previos en una misma ventana (el Worker viejo contra la v3 rompería la entrega). Escalar a reconciliación de inventario si hay egresos reales.
- Alternativa recomendada de emergencia: mantener la v3 descontando y **revertir solo el frontend** si el problema es de presentación.

## 8. Riesgos

- **Ventana de cutover:** si no se hace backfill (decisión 4.2), conviven dos semánticas y un despacho viejo podría reingresarse dos veces al anular. Mitigación: backfill + tests de transición.
- **Doble descuento residual:** cualquier ruta que cambie a `despachada` sin pasar por la v3 (PATCH legacy) dejaría de descontar. Mitigación: eliminar la ruta legacy de aprobación en T7 (la RPC siempre descuenta).
- **Edición profunda:** sin T3, editar un `pendiente` seguiría corrompiendo stock (bug preexistente). T3 es parte del alcance, no opcional.
- **Venta Anticipada y stock negativo:** se conserva tal cual (`permitir_stock_negativo`); documentar en el smoke.
- **Reportes históricos:** los movimientos `egreso` pasan a fecharse al aprobar en lugar de al entregar; los informes por rango de fechas de kardex reflejan el nuevo momento (contablemente deseable, pero cambia series históricas).

## 9. Fuera de alcance

- Comisiones y CxC (siguen calculándose al aprobar/entregar como hoy).
- Préstamos de inventario (`cliente_prestamos`, `devolver_prestamo_inventario_atomico`) — sin cambios.
- Migraciones de staging 277–282 del checkout ERP — no se promueven en este plan.
