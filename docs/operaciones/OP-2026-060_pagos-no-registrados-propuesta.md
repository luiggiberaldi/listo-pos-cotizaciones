# OP-2026-060 — 4 pagos ya hechos, registrados sin afectar los reportes de hoy (ejecutado)

**Fecha:** 2026-11-24 · **Producción:** corregido el 2026-11-24 con orden del dueño · **Cambios hechos:** 4 pagos registrados con su fecha real (ver "Lo que se hizo")
**Pedido del dueño:** Constructora Ew 2010 (cruce $850), Inversiones y Suministro Yahveh ($313,43), KIA 241 ($64,50) y Albert Omar Ruiz ($60,59) ya pagaron; hay que corregirlo sin que cambien los reportes de hoy.
**Antecedentes:** [OP-2026-039](OP-2026-039_clientes-reportados-como-pagados.md) y [OP-2026-047](OP-2026-047_abonos-no-registrados-y-pruebas-staging.md): el sistema suma bien; esos pagos **nunca se anotaron**.

## En resumen

- **Hecho el 2026-11-24, con tu orden.** Los 4 clientes quedaron en **$0**. Cada pago se anotó con la fecha en que realmente se pagó, así que **el reporte de hoy no cambió**: siguió con 0 abonos con fecha de hoy.
- La suma de todas las deudas bajó exactamente $1.288,52: de $73.688,22 a $72.399,70. Los saldos a favor no cambiaron ($674,15) y las comisiones tampoco.
- Cada pago quedó en la auditoría como `CORRECCION_PAGO_NO_REGISTRADO` (4 anotaciones), a nombre del usuario ADMINISTRADOR y autorizado por el dueño.

## Lo que se hizo

| Cliente | Monto | Cómo se anotó | Fecha del pago | Guion |
|---|---|---|---|---|
| Constructora Ew 2010 | $850,00 | **Cruce**, en el despacho #3347. Contra qué: "Cruce autorizado por el dueño" | 21-sep (día del despacho) | [op060_ew_yahveh_ejecutado.sql](OP-2026-060_scripts/op060_ew_yahveh_ejecutado.sql) |
| Inversiones y Suministro Yahveh | $313,43 | **USDT**, abono a la deuda ("pagó el viernes") | 20-nov, 4:30 p. m. (después del abono 41PRV) | el mismo |
| Albert Omar Ruiz Avila | $60,59 | **Transf. / Pago Móvil**, resto del comprobante 261114 ("pago 2 deudas"), en el despacho #3262 | 29-sep (día del comprobante) | [op060_albert_ejecutado.sql](OP-2026-060_scripts/op060_albert_ejecutado.sql) |
| KIA 241 | $64,50 | **Transf. / Pago Móvil**, diferencia del intercambio del despacho #3596. **El método no se informó**: se usó el mismo del resto del despacho | 02-oct (día del intercambio) | [op060_kia_ejecutado.sql](OP-2026-060_scripts/op060_kia_ejecutado.sql) |

Cómo funcionó cada guion:
- Antes de escribir, revisaba que la deuda siguiera igual.
- Si al final el saldo no quedaba en $0, no se guardaba nada.
- En el primer intento la base pidió indicar qué usuario registra el pago, y no se guardó nada. Se repitió con el usuario ADMINISTRADOR, que es el que registra los abonos.

**Efecto en otros reportes, que es lo correcto:**
- Los reportes del 21 y 29 de septiembre, del 2 de octubre y del 20 de noviembre ahora muestran estos pagos.
- El Cruce de Ew **no** cuenta como dinero cobrado: aparece como "Cruce" en el gráfico de formas de pago.
- El pago USDT de Yahveh sí suma a la cobranza del viernes 20-nov.

**Cómo deshacer uno:** anularlo desde la ficha del cliente, con motivo. Desde OP-2026-059 queda guardado en el archivo de movimientos borrados y la deuda vuelve sola.

**Ojo con las pantallas abiertas:** la app guarda en el equipo una copia de la lista de clientes para abrir más rápido. Como la corrección se hizo directo en la base, y no desde la ficha, las pantallas que ya estaban abiertas siguieron mostrando la deuda vieja: el dueño vio a Albert en $60,59 y a Yahveh en $313,43. La base ya decía $0 (comprobado de nuevo). Se arregla recargando la página (F5, o Ctrl+Shift+R si sigue igual). Si no, se actualiza sola en pocos minutos.

**Pendiente:** confirmar con administración el método real del pago de KIA. Si no fue transferencia o pago móvil, se anula y se registra de nuevo con la misma fecha.

## Propuesta original (antes de ejecutar)


- Hoy (24-nov) las 4 deudas siguen en el sistema, exactas: $850,00 · $313,43 · $64,50 · $60,59.
- **Propuesta:** anotar cada pago con la **fecha en que realmente se pagó**, no con la de hoy. Así los reportes de hoy no se mueven y los 4 clientes quedan en $0.
- Si se anotaran desde la ficha, el sistema les pondría la fecha de hoy y aparecerían como cobranza de hoy. Por eso se propone un guion revisado: [`op060_pagos_no_registrados.sql`](OP-2026-060_scripts/op060_pagos_no_registrados.sql) (**borrador, no ejecutado**).
- **Comisiones:** no cambian (ninguno de los 4 despachos tiene comisión pendiente de liberar).
- **Efecto secundario a saber:** los reportes de los días en que se pagó (septiembre, octubre y noviembre) pasarán a mostrar ese cobro. Es lo correcto, pero si ya imprimiste o enviaste esos reportes, cambiarán al volver a sacarlos.

## Lo que falta confirmar (administración, con el comprobante en mano)

| Cliente | Monto | Despacho | Falta confirmar | Fecha propuesta |
|---|---|---|---|---|
| Constructora Ew 2010 | $850,00 | #3347 | **Contra qué se cruzó** (deuda nuestra con ellos, mercancía, servicio) y la fecha del cruce | 21-sep (día del despacho) |
| Inversiones y Suministro Yahveh | $313,43 | #4804 | Método, referencia y fecha. Ojo: el 16-nov hay un pago de **$311,57** (ref. 59rfy). Si en el banco ese pago fue de $313,43, la corrección es otra: subir ese pago en $1,86 y la deuda se cubre igual | 20-nov (último pago) |
| KIA 241 | $64,50 | #3596 | Método, referencia y fecha (es la diferencia del cambio de cabillas) | 02-oct (día del cambio) |
| Albert Omar Ruiz | $60,59 | #3262 | Que el comprobante **261114** sea de $1.018,50 | 29-sep (día del comprobante) |

Y quién lo autoriza (queda en la auditoría).

## Cómo se haría (cuando lo apruebes)

1. Respaldo de producción.
2. Se completan en el guion los datos marcados "CONFIRMAR". Si falta alguno, el guion se detiene solo.
3. El guion revisa primero que las 4 deudas sigan iguales; si alguna cambió, no hace nada.
4. Anota los 4 pagos con su fecha real y una nota "corrección OP-2026-060", más una anotación en la auditoría por cada uno.
5. Muestra los 4 clientes (deben quedar en $0) y solo entonces se confirma.

**Cómo deshacerlo:** borrar esos 4 movimientos (se identifican por la nota "corrección OP-2026-060"); los saldos vuelven solos a como estaban.

## Relación con el paso a producción ([OP-2026-059](OP-2026-059_paso-a-produccion-cxc.md))

Se puede hacer antes o después. Si se hace **después**, el archivo de movimientos borrados también protegería una eventual reversa. No depende de las migraciones nuevas.
