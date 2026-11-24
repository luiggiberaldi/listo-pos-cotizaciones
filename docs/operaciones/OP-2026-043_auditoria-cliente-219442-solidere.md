# OP-2026-043 — Auditoría del cliente 219442 (INVERSIONES SOLIDERE C,A)

- **Fecha:** 2026-11-23
- **Pedido por:** luigi
- **Tipo:** revisión (solo lectura en producción, ningún cambio guardado)
- **Estado:** revisión terminada; quedan 4 preguntas para administración/caja

## En resumen

- El sistema dice que Solidere debe **$34.188**, y esa cifra **cuadra con todos los registros**: 7 despachos a crédito por $34.266 menos un único abono de $78.
- Los "abonos" que se ven en el **reporte de ventas** y no en Cuentas por Cobrar son dos despachos pagados con **"Cruce"**: #1523 ($3.071) y #1940 ($4.138), en total **$7.209**. Esos despachos se pagaron en el momento y nunca fueron deuda, por eso no salen en la cartera. **No bajan el saldo**: aunque se hubieran registrado como deuda y después como abono, el resultado sería el mismo.
- **Saldo real hoy según los registros: $34.188.** Solo puede bajar si administración confirma algo que el sistema no tiene (ver las 4 preguntas). La deuda más vieja (#624, $21.600) tiene **185 días**.

## Qué se revisó

Todo en producción y solo leyendo:

- Ficha del cliente (código 219442, RIF J-31641582-1).
- Sus 11 despachos con sus artículos, formas de pago y totales.
- Sus 8 movimientos de cartera (cargos y abonos).
- Sus 11 cotizaciones.
- Su historial en la auditoría (69 registros).
- Búsqueda de "Solidere", su RIF y su código en despachos de otros clientes, en la cartera de otros clientes, en cuentas por pagar, en proveedores y en órdenes de compra. **No apareció en ningún otro sitio.**
- Cómo arma el reporte de ventas sus "formas de pago". Usa solo lo que se anotó en cada despacho al despacharlo; **los abonos de cartera nunca aparecen en ese reporte**.

## Los 11 despachos

| # | Fecha | Estado | Total | Cómo se pagó | ¿Está en la cartera? |
|---|---|---|---|---|---|
| 384 | 11-may | **pendiente** (nunca salió) | $1.086 | Cta por cobrar | No (aún no se despachó) |
| 454 | 13-may | **pendiente** (nunca salió) | $500 | Cta por cobrar | No (aún no se despachó) |
| 624 | 22-may | entregada | $21.600 | Cta por cobrar | Sí, cargo $21.600 |
| 625 | 22-may | entregada | $475 | Cta por cobrar | Sí, cargo $475 |
| 866 | 03-jun | entregada | $950 | Cta por cobrar | Sí, cargo $950 |
| 1523 | 07-jul | entregada | $3.071 | **Cruce** | No (pagado al despachar) |
| 1940 | 27-jul | entregada | $4.138 | **Cruce** | No (pagado al despachar) |
| 2044 | 30-jul | entregada | $232 | Cta por cobrar (primero se anotó **Cruce** y 18 minutos después se cambió a crédito) | Sí, cargo $232 |
| 2790 | 31-ago | entregada | $9.900 (incluye $200 de flete) | Cta por cobrar | Sí, cargo $9.900 |
| 3051 | 09-sep | entregada | $895 | Cta por cobrar | Sí, cargo $895 |
| 4838 | 20-nov | entregada | $214 (incluye $25 de flete) | Cta por cobrar | Sí, cargo $214 |

En todos los despachos, la suma de artículos más flete coincide con el total.

**Ventas entregadas en total: $41.475.** De eso, $7.209 se pagaron con Cruce y $34.266 quedaron a crédito.

## La cartera, movimiento por movimiento

| Fecha | Movimiento | Monto | Nota |
|---|---|---|---|
| 22-may | Cargo #625 | +$475 | |
| 22-may | Cargo #624 | +$21.600 | |
| 03-jun | Cargo #866 | +$950 | |
| 16-jun | **Abono Zelle** | −$78 | "PAGO PARCIAL FACTURA", referencia "ALEJANDRO CUEVA", sin despacho elegido |
| 30-jul | Cargo #2044 | +$232 | |
| 09-sep | Cargo #3051 | +$895 | |
| 09-sep | Cargo #2790 | +$9.900 | Se volvió a cargar al corregir el flete; el cargo anterior de $9.700 se reemplazó |
| 20-nov | Cargo #4838 | +$214 | |
| | **Saldo** | **$34.188** | igual al saldo guardado en la ficha |

### Qué despacho sigue debiendo cuánto

El abono de $78 se reparte al despacho más viejo:

| Despacho | Debe hoy | Días desde el despacho |
|---|---|---|
| #624 | $21.600 | 185 |
| #625 | $397 | 185 |
| #866 | $950 | 173 |
| #2044 | $232 | 116 |
| #2790 | $9.900 | 84 |
| #3051 | $895 | 75 |
| #4838 | $214 | 3 |
| **Total** | **$34.188** | |

## Por qué los $7.209 del reporte de ventas no salen en la cartera

El reporte de ventas muestra cómo se pagó **cada despacho en el momento de despacharlo**. #1523 y #1940 se marcaron como "Cruce": se dieron por pagados al salir, así que **nunca se creó deuda** y Cuentas por Cobrar no tiene nada que mostrar.

Una comparación sencilla: es como una compra pagada en caja. Sale en el resumen de ventas del día, pero no en la libreta de fiados.

**Esto no esconde dinero a favor del cliente.** Si esos dos despachos se hubieran anotado como deuda y luego pagado con un abono "Cruce", el saldo final sería el mismo $34.188. Lo único que cambia es dónde se ve. (Desde OP-2026-042 existe en staging la regla de escribir contra qué se cruzó; aquí no quedó anotado.)

## Lo que no se puede comprobar con los datos (preguntas para administración/caja)

1. **¿Hubo más pagos de Solidere que no se anotaron, o que se borraron?** Entre mayo y el 23-oct el sistema **no guardaba en la auditoría** cuándo se registraba o borraba un abono. Antes de esa fecha, un abono borrado no deja rastro. Desde el 23-oct no hay ningún abono revertido de este cliente. Que en 6 meses solo haya un pago de $78 frente a $34.188 de deuda es poco usual. **Si caja tiene comprobantes, cada uno baja el saldo por su monto.**
2. **¿Contra qué fueron los Cruces?** Solidere no aparece como proveedor, ni en órdenes de compra, ni en cuentas por pagar. Si el Cruce fue porque la empresa le compró algo a Solidere y el valor de esa compra fue **mayor** que $7.209, la diferencia es un pago que falta anotar y bajaría el saldo.
3. **¿El #2044 ($232) también fue Cruce?** Primero se registró como Cruce y a los 18 minutos se cambió a crédito. Si el Cruce era el correcto, el saldo baja $232.
4. **¿Los despachos #384 ($1.086) y #454 ($500) salieron o no?** Están "pendientes" desde mayo y no son deuda. Si la mercancía sí se entregó, el saldo **subiría** $1.586. Si no se entregó, conviene anularlos para que no confundan. El #454 (50 sacos de cemento) se parece al #625 (50 sacos, 9 días después), así que puede ser una venta repetida.

## Saldo real de hoy

| Escenario | Saldo |
|---|---|
| **Según todos los registros (lo más probable mientras no haya comprobantes)** | **$34.188** |
| Si el #2044 sí fue Cruce | $33.956 |
| Si hay pagos con comprobante que no están en el sistema | $34.188 menos esos pagos |
| Si los despachos pendientes #384 y #454 sí se entregaron | $35.774 |

## Datos técnicos

- Cliente `b5cb33e3-00d1-4879-a759-c017fa8c3b97`, cuenta de producción `74dd6821-…`.
- El reporte de ventas (`obtener_reporte_ventas_operaciones` y `src/hooks/useReporteVentas.js`) usa `notas_despacho.forma_pago_cliente`/`forma_pago` de los despachos despachados o entregados, y además resta las `devolucion_credito`. No lee los abonos de `cuentas_por_cobrar`.
- Auditoría de abonos (`REGISTRAR_ABONO`/`REVERTIR_ABONO`): primer registro el 2026-10-23.
- Los datos crudos de esta revisión quedaron en `.tmp-op040/op043/` (carpeta ignorada por git, porque tiene datos reales de clientes).
- Producción no se modificó. Todas las consultas se hicieron en modo solo lectura (`lib.py` de OP-2026-040).
