# OP-2026-090 — Auditoría del despacho DES-04938 (préstamo de 120 m³) y qué pasa al reabrirlo

**Fecha:** 2026-11-25 · **Alcance:** solo staging, solo lectura (las simulaciones se hicieron dentro de una transacción que siempre se deshace; se comprobó después que nada cambió). **No cambia producción.**
**Estado:** auditado. Hay **1 falla real sin corregir** (punto 1 de "Hallazgos").

## En resumen

- **Los números del caso cuadran:** se prestaron 120 m³; 20 volvieron y 100 se facturaron. El inventario, el cobro y el saldo del cliente coinciden.
- **Si se toca "Reabrir despacho" hoy:** el sistema **lo rechaza y no cambia nada**, con el aviso "No se puede revertir o anular un despacho que tiene préstamos asociados con devoluciones o facturaciones ya registradas". Comprobado en la base real.
- **Falla encontrada:** existe otro camino (revertir la entrega a "aprobado", que la pantalla no ofrece pero el servidor acepta) que **no tiene ese freno**. Si alguien lo usara, **borraría el cobro de $2.200 del cliente** y la comisión, y el préstamo seguiría marcado como "facturado". Comprobado dentro de una prueba que se deshizo.

## El caso, paso a paso (datos reales de staging)

| Hecho | Dato |
|---|---|
| Cotización 4938 | 100 m³ a $22 = $2.200 (aceptada) |
| Despacho DES-04938 | Se aprobó con 100 m³ y luego se editó a 120 m³ (préstamo); entregado; total del despacho $0 (los préstamos no se cobran al entregar) |
| Préstamo | 120 prestados · 20 devueltos · 100 facturados · estado "facturado" |
| Inventario (Kardex) de la grava | 600 → aprobar −100 → editar ítems −20 → devolución del préstamo +20 = **500** (el stock actual es 500 ✓) |
| Cobro | 1 cargo de **$2.200** = 100 × $22 (precio del despacho original), anotando la tasa del día; saldo del cliente $2.200 ✓ |
| Devoluciones parciales | ninguna (la devolución de los 20 se hizo por la ficha del cliente → Préstamos) |

## Qué pasa si se quiere "Reabrir despacho"

1. La tarjeta envía "volver a pendiente". Antes de tocar nada, la base revisa los préstamos del despacho y, como hay 20 devueltos y 100 facturados, **se detiene** (`PRESTAMO_YA_TIENE_DEVOLUCIONES_O_FACTURAS`).
2. Como todo ocurre en una sola transacción, **no queda nada a medias**: el despacho sigue entregado, el stock en 500, el cobro y el saldo igual.
3. El mensaje es claro pero **no dice qué hacer en su lugar**.

## Hallazgos

1. **(Falla, sin corregir) Revertir la entrega a "aprobado" no revisa los préstamos.** La regla de protección solo se aplica al pasar a "pendiente" o "anulada". Con "aprobado" borra todos los movimientos de cuentas por cobrar del despacho (incluido el cobro del préstamo) y la comisión. Resultado: el cliente dejaría de deber $2.200 sin dejar rastro, y el préstamo seguiría como "facturado". La pantalla actual no ofrece ese botón, pero el servidor lo acepta con un rol de supervisor, administración, jefe o desarrollador.
2. **Dato inconsistente en el despacho:** tiene anotado un pago en efectivo de **$2.640** (120 × $22) aunque su total es $0 y al cliente se le cobró $2.200 a cuenta. No hay ningún abono real, pero los reportes que lean esa anotación podrían contar un cobro que no ocurrió.
3. **Comisión en cero:** la comisión del vendedor se generó al entregar (cuando el total era $0) y **no se recalcula** al facturar el préstamo. Hoy esos $2.200 vendidos le generan $0 de comisión. Es una decisión de negocio por confirmar.
4. **Tasa del cobro sin verificar:** el cobro usó 924,35 Bs/$; la cotización y el despacho tienen 1.108. No pude comprobar cuál era la tasa BCV real de ese momento.
5. **Sin salida para el dueño:** si de verdad se quiere deshacer una facturación de préstamo, hoy no hay forma guiada (no existe "deshacer facturación").

## Pruebas hechas

- Lectura de despacho, ítems, préstamo, cobros, cotización, Kardex y comisión.
- Dos simulaciones de reapertura en una transacción que siempre se deshace: a "pendiente" → rechazada; a "aprobado" → habría borrado 1 cobro y 1 comisión. Después se verificó: despacho entregado, saldo $2.200, 1 cobro, stock 500, préstamo facturado:100.

## Pendiente

- Corregir el hallazgo 1 (propuesta: aplicar la revisión de préstamos también al revertir a "aprobado") y agregar su prueba.
- Decidir los puntos 2, 3, 4 y 5 con el dueño.
