# OP-2026-063 — CONSTRUACERO LOS GUAYOS (#155297): deuda en $0 sin tocar el reporte de hoy

**Fecha:** 2026-11-24 · **Producción:** corregido el 2026-11-24 con orden del dueño · **Guion:** [op063_guayos_ejecutado.sql](OP-2026-063_scripts/op063_guayos_ejecutado.sql)
**Pedido del dueño:** "a ese cliente también déjalo en 0, ya no tiene deuda, sin afectar los reportes de hoy".
**Antecedente:** se hizo igual que el Cruce de Constructora Ew en [OP-2026-060](OP-2026-060_pagos-no-registrados-propuesta.md).

## En resumen

- **CONSTRUACERO LOS GUAYOS C.A.** (J-50824330-7) pasó de **$1.345,50 de deuda a $0**. Conserva sus **$450 de saldo a favor**.
- Se anotó como **Cruce autorizado por el dueño**, con fecha **18-nov**, el día del despacho #4800. Un cruce es un pago sin dinero: no cuenta como cobranza.
- **El reporte de hoy no cambió en movimientos:** sigue con 1 cargo de $2.485 y 0 abonos. Lo único que baja es la deuda total, que es lo correcto.
- La suma de todas las deudas bajó exactamente $1.345,50: de **$74.884,70 a $73.539,20**, y los clientes con deuda pasaron de 19 a 18.

## De dónde salía la deuda

| Parte | Monto | Origen |
|---|---|---|
| Cargo del 18-nov | $1.345,00 | Diferencia del intercambio del despacho **#4800** |
| Resto de mayo | $0,50 | Factura **#679**: se pagó con un Cruce de $1.233 sobre $1.233,50 (28-jul) y quedaron 50 céntimos |
| **Total** | **$1.345,50** | |

El saldo a favor de $450 viene del excedente del intercambio #4211 (23-oct). No se usó.

## Qué respondió el dueño

- **Cómo se saldó:** "pagó los $1.345,50 completos" y "no hubo dinero".
- **Fecha:** 18-nov, el día del #4800.
- **Confirmación final:** "Sí, ejecútalo" a esta pregunta: *Cruce de $1.345,50 con fecha 18-nov, no cuenta como dinero, conserva sus $450 a favor*.

## Lo que se hizo

- **Dos abonos tipo Cruce**, cada uno en su despacho y con fecha 18-nov a las 2:30 p. m., después del cargo de las 2:20 p. m.:
  - $1.345,00 en el #4800.
  - $0,50 en el #679.
- Los registra el usuario ADMINISTRADOR, con la nota "corrección OP-2026-063".
- **Una anotación en la auditoría** (`CORRECCION_PAGO_NO_REGISTRADO`) a nombre del dueño.
- **El guion era "todo o nada".** Antes de escribir revisó que la deuda siguiera en $1.345,50 y el saldo a favor en $450. Al final, si la deuda no quedaba en $0 o el saldo a favor cambiaba, no guardaba nada.
- **Comisiones:** no cambian, porque ninguno de los dos despachos tiene comisión.

## Comprobación (después de ejecutar)

| | Antes | Después |
|---|---|---|
| Deuda del cliente / saldo a favor | $1.345,50 / $450 | **$0 / $450** |
| Deuda total (clientes activos) | $74.884,70 (19 clientes) | **$73.539,20 (18)** |
| Saldos a favor (todos) | $674,15 | $674,15 |
| Movimientos con fecha de hoy | 1 cargo de $2.485 · 0 abonos | **igual** |
| Reporte "Este mes": abonos / cruces / cobros en dinero | $67.421,70 / $3.085,55 / $64.328,75 | $68.767,20 / $4.431,05 / **$64.328,75 (igual)** |
| Reporte del 18-nov: cruces | $0 | $1.345,50 |
| Alertas de vencimiento | 36 | 35: se fue la de los $0,50 de la #679, vencida desde junio |

En el reporte de hoy, el "saldo inicial" y el "CxC al cierre" bajan $1.345,50 porque la deuda ya se saldó el 18-nov. Es lo correcto; la actividad del día no cambia.

## Cómo deshacerlo

Anular los 2 movimientos "corrección OP-2026-063" desde la ficha del cliente, con motivo. La deuda vuelve sola.

## Pendiente

- Las pantallas que ya estaban abiertas pueden seguir mostrando $1.345,50 hasta recargar (F5).
