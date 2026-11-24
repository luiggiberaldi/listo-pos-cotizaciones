# OP-2026-055 — Que nada se borre sin rastro: anular con motivo, archivo de movimientos borrados y Cruce explicado (staging)

**Fecha:** 2026-11-24 · **Entorno de los arreglos:** solo staging (copia de pruebas) · **Producción:** sin cambios
**Fallas que atiende:** I3 y N3; se comprueban N5 y N7 (fase 4 del [plan OP-048](../plans/OP-2026-048_plan-arreglo-26-fallas-staging.md)). Ver [REGISTRO-FALLAS-CODIGO.md](REGISTRO-FALLAS-CODIGO.md)

## En resumen

- **Todo movimiento de dinero que se borre queda guardado en un archivo**, con su copia completa, quién lo borró, cuándo, por qué y desde qué operación. Lo hace una regla de la base, así que cubre **todos** los caminos de borrado: revertir, reabrir, edición profunda, devoluciones y limpiezas, no solo los que se acordaron de anotar.
- **"Revertir" ahora es "Anular" con motivo obligatorio.** La ficha muestra una lista de **"Movimientos anulados"** con monto, referencia, motivo y quién lo hizo.
- **No se pueden anular sueltos los movimientos que vienen de una devolución de mercancía**; se corrigen desde la devolución.
- **El "Cruce" en la forma de pago de un despacho exige decir contra qué se cruzó**, igual que en los abonos. En las pantallas aparece el campo "Contra qué se cruzó (obligatorio)". Un Cruce viejo que no se cambia se respeta.
- **Pruebas:**
  - 10 de 10 contra staging y 5 de 5 en un navegador real.
  - 465 de 465 automáticas, y la app se arma bien.
  **Nada está en producción.**

## 1. Qué estaba mal

| Falla | Antes |
|---|---|
| **I3** | "Revertir abono" borraba el movimiento para siempre. Desde OP-050 la auditoría guardaba una copia, pero no había motivo ni forma de verlo en la ficha. También dejaba revertir abonos de una devolución, desarmando la devolución |
| Borrados en otros caminos | Reabrir un despacho, la edición profunda o una devolución borraban movimientos sin dejar copia completa |
| **N3** | En la forma de pago del despacho, un "Cruce" se guardaba sin decir contra qué se cruzó (Solidere: $7.209 sin explicación) |

## 2. Qué cambió para el operador

- **Ficha del cliente → botón de revertir.** Se abre "¿Anular abono?" con el monto, la referencia y lo que pasará con la deuda o el saldo. Hay que escribir el motivo (10 caracteres o más); sin motivo, el botón **Anular** queda desactivado.
- **Ficha → "Movimientos anulados"** (solo administración, jefe y desarrollador). Por ejemplo: "Abono $45.00 · Ref. Z-PANTALLA-055 · Motivo: … · OP042 Admin Prueba". También aparecen los movimientos que borró el sistema, con la operación que los borró (por ejemplo "reabrir_despacho_con_pagos_staging").
- Al intentar anular un abono de devolución sale: "Este movimiento viene de una devolución de mercancía. Corrígelo desde la devolución del despacho, no desde la ficha."
- **Cotizaciones, venta rápida, editar despacho y editar ítems:** al elegir "Cruce" aparece "Contra qué se cruzó (obligatorio):". Si se deja vacío, el servidor no deja guardar y lo explica.

## 3. Cómo funciona

- **Archivo `cxc_movimientos_borrados`** (migración 307): una regla de la base (disparador "antes de borrar") copia la fila completa antes de cualquier borrado en cuentas por cobrar, con motivo, operador y origen. El origen es la operación que lo borró o "borrado directo". Solo el servidor puede leerlo, y la ficha lo consulta en `GET /api/cxc/movimientos-borrados`.
  - Excepción intencional: las limpiezas de datos de prueba que desactivan las reglas de la base no dejan copia.
- **Anular** (`cxc_anular_movimiento_staging`), en un solo paso:
  1. valida el motivo, el tipo y que no venga de una devolución;
  2. revisa que un consumo de saldo a favor no esté ya conciliado y que un saldo a favor no esté ya usado;
  3. borra (la regla guarda la copia con el motivo y el operador);
  4. anota en la auditoría con el motivo y la copia.
- **Cruce** (`src/utils/formaPagoReglas.js`): se exige el campo del Cruce con 5 caracteres o más al crear despacho, editar pago, editar ítems y en la venta rápida. Un Cruce viejo sin explicación cuyo monto no cambia se respeta, para no trabar correcciones de otros datos.

## 4. N5 y N7 (comprobación)

- **N5:** los cobros a destino conciliados ya dejaban anotación (`COD_CONCILIADO_CON_EVIDENCIA`, medido en OP-050). Las devoluciones e intercambios ya dejan `DEVOLUCION_PARCIAL`: se comprobó en OP-054 (D1) al arreglar la categoría (N12).
- **N7:** todos los movimientos nuevos de estas fases quedan en la auditoría: abonos, saldo a favor, anulaciones, reabrir, anular, edición profunda y devoluciones.

## 5. Pruebas

**Contra staging** (`construacero-staging/scripts/op055-sin-rastro-api.mjs`): **10/10 bien**.

| # | Caso | Resultado |
|---|---|---|
| S1 | Anular con motivo corto | Rechazado; el abono sigue |
| S2 | Anular con motivo | La deuda sube $100 (de $534 a $634) |
| S2 | Copia en el archivo | Fila completa (referencia "Z-OP055"), motivo, "OP042 Admin Prueba", origen "anular_movimiento" |
| S2 | Auditoría | `REVERTIR_ABONO` con el motivo y la copia |
| S3 | Anular un abono de devolución | Bloqueado con mensaje claro |
| S4 | Consulta de movimientos anulados | La ficha los recibe |
| S5 | Reabrir el despacho | La deuda borrada queda en el archivo con origen "reabrir_despacho_con_pagos_staging" |
| N3 | Cruce sin explicación | No deja guardar: "…debe decir contra qué se cruzó…" |
| N3 | Cruce con "Factura de flete #45 que les debemos" | Se guarda |
| N3 | Cruce viejo sin explicación que no cambia | Se respeta |

**Pantalla** (`scripts/op055-sin-rastro-pantalla.mjs`): **5/5 bien**.
- El modal de anular muestra el monto y no deja confirmar sin motivo.
- Con motivo, anula y se cierra.
- "Movimientos anulados" muestra el abono con su referencia y motivo.
- No hay errores en la página.

Capturas en `tmp/op055/`.

**Automáticas:** 465/465 en 50 archivos (nuevo: `src/utils/__tests__/formaPagoReglas.test.js`). **Construcción de la app:** correcta.

Ajustes hechos durante la prueba:
- El servidor no tenía permiso para leer la tabla nueva: se agregó.
- El origen de los borrados no se detectaba bien: se amplió la lectura de la orden de la base. Quedó en la migración 307 y está reaplicada.
- La validación del Cruce en "editar pago" se movió para que no consulte la base antes de los controles de permiso, que es lo que exigen las pruebas existentes.

## 6. Archivos cambiados (staging)

- `construacero-staging/supabase/migrations/307_staging_cxc_nada_se_borra_sin_rastro.sql` (+ `_rollback.sql`): archivo, regla de copia y anulación con motivo. **Aplicada en staging y verificada.**
- `construacero-staging/api/handlers/cxc.js`: `handleRevertirAbono` usa la anulación con motivo; nueva `handleMovimientosBorradosCliente`.
- `construacero-staging/worker.js`: ruta `GET /api/cxc/movimientos-borrados`.
- `construacero-staging/src/utils/formaPagoReglas.js` (nuevo), `api/handlers/despachos.js` y `api/handlers/cotizaciones.js`: regla del Cruce.
- `construacero-staging/src/hooks/useCuentasCobrar.js` y `src/components/clientes/FichaClienteModal.jsx`: modal de anular con motivo y lista de movimientos anulados.
- `src/views/CotizacionesView.jsx`, `src/views/VentaRapidaView.jsx`, `src/components/despachos/EditDespachoModal.jsx` y `EditarItemsDespachoModal.jsx`: campo "Contra qué se cruzó".
- Pruebas: `src/utils/__tests__/formaPagoReglas.test.js`, `scripts/op055-sin-rastro-api.mjs` y `scripts/op055-sin-rastro-pantalla.mjs`.

## 7. Pendiente

- **No está en producción.** Necesita un caso propio, las migraciones 301 a 307 y tu aprobación.
- El plan proponía "anular con marca" (dejar el abono en la tabla marcado como anulado). Se eligió el archivo aparte porque marcar habría obligado a cambiar todos los cálculos de saldo del sistema. El resultado para el usuario es el mismo: nada desaparece y todo se puede ver.
- El modal de pagos de un despacho **entregado** (`EditarPagoEntregadoModal`) no tiene el campo del Cruce. Si alguien agrega un Cruce nuevo ahí, el servidor lo rechaza con el mensaje.
- Sin publicar en GitHub: no hay solicitud de cambio ni commit.
