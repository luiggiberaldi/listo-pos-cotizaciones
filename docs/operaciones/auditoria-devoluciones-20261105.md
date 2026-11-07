# Auditoría de devoluciones (producción, solo lectura)

> **Estado: PAUSADO por decisión del dueño (2026-11-05). No se corrigió nada.** Todo lo de abajo queda como referencia para retomarlo cuando se decida.

**Fecha:** 2026-11-05 · **Qué se hizo:** solo consultas de lectura. No se modificó ningún dato.

## En resumen

- Hay **43 ventas con devolución** (56 registros, $21.141 devueltos). 37 están despachadas/entregadas y 6 anuladas.
- **El sistema actual funciona bien:** al registrar una devolución, el total de la venta baja, el saldo del cliente se ajusta y la comisión se reduce. **27 de las 37 cuadran al centavo**, incluidas las devoluciones con cambio de producto.
- **9 ventas de julio (devoluciones del 17 al 29/07, antes del 17/08) quedaron con el total sin descontar**: suman **$11.417,90** de más. En esas, las comisiones tampoco se ajustaron (unos **$182** de más, sin pagar según lo revisado).
- **1 venta de septiembre (DES-3248)** tiene una diferencia de $15 (cambio de $27 por $12 devueltos, el total no subió).
- El caso DES-04455 (Josué), que parecía raro, **está bien**: los $31,80 de diferencia son por el cambio (devolvió $152,64 y se llevó $184,44 en otros artículos).

## Por qué pasó

El proceso "atómico" de devoluciones (que actualiza total, saldo del cliente y comisión en un solo paso) se instaló el **17/08/2026**. Las 9 ventas de julio se devolvieron con el proceso anterior, que no ajustó el total de la venta ni la comisión. Desde entonces no hay casos nuevos del problema.

## Ventas de julio con el total sin descontar

| Venta | Fecha devolución | Total guardado | Debería ser | Diferencia | Comisión guardada | Estado comisión |
|---|---|---|---|---|---|---|
| DES-974 | 25/07 | 49,47 | 39,90 | 9,57 | 1,48 | — |
| DES-1503 | 28/07 | 12.649,00 | 10.753,00 | 1.896,00 | 372,60 | cta_cobrar |
| DES-1703 | 17/07 | 19.268,80 | 14.958,40 | 4.310,40 | 552,02 | cta_cobrar |
| DES-1771 | 28/07 | 400,56 | 369,81 | 30,75 | 12,02 | — |
| DES-1855 | 23/07 | 155,58 | 131,20 | 24,38 | sin comisión | — |
| DES-1861 | 27/07 | 18.263,60 | 15.302,60 | 2.961,00 | sin comisión | — |
| DES-1863 | 27/07 | 5.544,00 | 3.395,70 | 2.148,30 | sin comisión | — |
| DES-1932 | 25/07 | 21,75 | 0,00 | 21,75 | 0,65 | pendiente |
| DES-1973 | 29/07 | 60,35 | 44,60 | 15,75 | 1,81 | — |

## Otras cosas revisadas que están bien

- Un reembolso genera dos asientos en la cuenta del cliente (saldo a favor + entrega del reembolso). Se anulan entre sí; no es doble cobro (DES-4370, DES-4179, DES-4419).
- Los artículos de la venta no se reducen al devolver: la devolución queda en un registro aparte y el total se ajusta. Por eso "Mis ventas", que usa el total, es correcto para las ventas desde el 17/08.

## Hallazgo adicional: saldo del cliente sin ajustar

Seis de las nueve ventas de julio **no tienen ningún asiento de la devolución en la cuenta por cobrar del cliente**: DES-974, 1503, 1771, 1855, 1932 y 1973. La más importante es **DES-1503 ($1.896)**: el cliente puede seguir debiendo esa parte. DES-1703, 1861 y 1863 sí tienen su asiento. Esto no lo corrige el script y hay que revisarlo con administración.

## Qué falta decidir

1. Confirmar con administración que esas 9 devoluciones de julio sí se hicieron físicamente (el cliente devolvió la mercancía y el stock entró).
2. Si sí: una corrección única, con copia de seguridad y prueba previa, que baje el total de esas 9 ventas y ajuste sus comisiones.
3. Revisar DES-3248 ($15).

## Cómo retomarlo

1. Administración confirma que esas 9 devoluciones sí ocurrieron (mercancía devuelta al almacén).
2. Se revisa el saldo de los clientes de las 6 ventas sin asiento (sobre todo DES-1503).
3. Simulación (no modifica nada): `node scripts/corregir-devoluciones-julio.mjs`
   - Resultado de la simulación del 05/11/2026: ventas −$11.417,90 y comisiones −$181,67.
4. Solo con autorización explícita del dueño: `node scripts/corregir-devoluciones-julio.mjs --aplicar --produccion` (guarda una copia de seguridad antes de cambiar).

Herramientas de consulta usadas (solo lectura): `tmp/medir-devoluciones.mjs`, `tmp/devoluciones-a-fondo.mjs`, `tmp/devoluciones-detalle.mjs`.
