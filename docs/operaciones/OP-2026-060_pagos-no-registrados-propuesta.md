# OP-2026-060 — Propuesta: registrar 4 pagos ya hechos sin afectar los reportes de hoy

**Fecha:** 2026-11-24 · **Producción:** solo se leyó · **Cambios hechos:** ninguno
**Pedido del dueño:** Constructora Ew 2010 (cruce $850), Inversiones y Suministro Yahveh ($313,43), KIA 241 ($64,50) y Albert Omar Ruiz ($60,59) ya pagaron; hay que corregirlo sin que cambien los reportes de hoy.
**Antecedentes:** [OP-2026-039](OP-2026-039_clientes-reportados-como-pagados.md) y [OP-2026-047](OP-2026-047_abonos-no-registrados-y-pruebas-staging.md): el sistema suma bien; esos pagos **nunca se anotaron**.

## En resumen

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
