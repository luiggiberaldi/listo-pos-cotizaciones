# OP-2026-045 — TecnoHierro Vp C.a (#937762): ¿hay un abono de $380?

- **Fecha:** 2026-11-23
- **Pedido por:** luigi
- **Tipo:** revisión (solo lectura en producción, ningún cambio guardado)
- **Estado:** revisión terminada; falta el comprobante del cliente
- **Relacionado:** [OP-2026-044](OP-2026-044_auditoria-12-clientes-abonos.md)

## En resumen

- **No hay ningún abono de $380 para TecnoHierro en el sistema.** Tampoco aparece anotado en otro cliente, en ningún despacho, ni como abono borrado en la auditoría.
- Su deuda de **$434,40** cuadra con los registros. Es lo que queda del despacho **#4100** (20-oct, $2.434,40), al que se le abonaron dos pagos USDT de $1.000 (28-oct y 09-nov).
- Si el cliente tiene un comprobante de $380, hay que registrarlo como abono, y la deuda quedaría en **$54,40**.

## Qué se revisó

- Sus 13 despachos: 12 entregados y 1 anulado (#2686, a crédito, sin pago anotado).
- Sus 28 movimientos de cartera: 10 cargos y 18 abonos. Ninguno es de $380.
  - El único parecido es un abono de **$480** del 13-oct por Transferencia/Pago Móvil, con la referencia "OAGO EL 26 SEPTIEMBRE". Con él se terminaron de pagar los #2874 y #3020.
- Toda la base:
  - Abonos o créditos entre $379 y $381 en cualquier cliente: solo dos, de otros clientes y de otras fechas (08-jun, Ferretería El Punto Amarillo; 23-sep, David Ramírez, un cobro a destino).
  - Movimientos o despachos que mencionen "Tecno", su RIF o su código en otros clientes: ninguno.
  - Despachos desde septiembre con un pago de $380: solo el #3766 de Adalberto Rojas, que es una compra suya pagada en efectivo.
  - Auditoría de abonos de $380 registrados o revertidos: ninguno.

## Cómo está la cuenta

| Despacho | Monto | Pagado | Debe |
|---|---|---|---|
| #1060 a #3341 (9 despachos a crédito) | $14.360,68 | $14.360,68 | $0 |
| #4100 (20-oct) | $2.434,40 | $2.000 (USDT $1.000 el 28-oct + USDT $1.000 el 09-nov) | **$434,40** |

*El total de #1060 a #3341 ya descuenta la devolución de $780 del #1979.*

## Qué hacer

Pedirle a caja o al cliente el comprobante de los $380: fecha, método y referencia.

- Si existe, se registra en la ficha con **Abonar deuda**: monto 380, el método que corresponda y la referencia del comprobante. La deuda queda en $54,40.
- Si el cliente pagó en efectivo a un vendedor o a Enzo, confirmar con esa persona antes de registrarlo.
