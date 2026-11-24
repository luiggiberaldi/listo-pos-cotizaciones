# OP-2026-039 — Revisión de 4 clientes que administración reporta como pagados

**Fecha:** 23 de noviembre de 2026
**Tipo:** revisión, solo lectura (producción)
**Pedido:** la administradora indica que estos clientes ya pagaron, pero el sistema los sigue mostrando con deuda:

| Cliente | Lo que dice administración | Deuda en el sistema |
|---|---|---|
| Constructora Ew 2010, C.A. | Pagó con un **cruce** de $850 | $850,00 |
| Inversiones y Suministro Yahveh, C.A. | Pagó $313,43 | $313,43 |
| KIA 241, C.A. | Pagó $64,50 | $64,50 |
| Albert Omar Ruiz Ávila | Pagó $60,59 | $60,59 |

**Cambios hechos:** ninguno.

## En resumen

- **El sistema no está sumando mal.** En los 4 casos la deuda es exactamente lo que se compró menos lo que se **registró** como pagado.
- **El problema es que esos 4 pagos nunca se registraron**, o se registraron por un monto menor. **No existen en el sistema**: no están en el cliente correcto, ni en otro cliente, ni en el historial de cambios.
- **Albert tiene la explicación más clara:** un mismo comprobante (261114) pagó a **dos clientes**, Carlos Pacheco y Albert. A Albert se le anotaron $259,41 cuando le faltaban **$320**. Esa diferencia es justo **$60,59**.
- **Solución:** registrar los 4 pagos que faltan desde la ficha de cada cliente, con el comprobante en mano. Abajo están los pasos.

## Detalle por cliente

### 1. Constructora Ew 2010 — debe $850 (despacho #3347)
- El despacho #3347 se hizo el **21-sep-2026** a crédito por $850 y venció el 29-sep.
- Ese mismo día, **dos horas antes**, el cliente había pagado "PAGO TOTAL DEUDA" ($1.316,20). Ese pago cubrió todo lo anterior, pero no el #3347, que se creó después.
- **No hay ningún cruce registrado**, ni pagos posteriores. Tampoco aparece en el historial de cambios un cruce que se haya cargado y luego borrado.
- **Qué falta:** registrar el cruce de $850. Antes, conviene que administración anote **contra qué** se cruzó (una deuda nuestra con ellos, mercancía, servicio), porque el sistema no tiene cómo comprobarlo.

### 2. Inversiones y Suministro Yahveh — debe $313,43 (resto del despacho #4804)
- Despachos desde el 27-oct: #4352 ($2.604), #4551 ($2.640), #4632 ($2.300), #4745 ($354,60) y #4804 ($3.037,02 − $7,40 de devolución). Total: **$10.928,22**.
- Pagos registrados en noviembre: 12 pagos que suman **$10.614,79** (el último, $235 el 20-nov).
- Diferencia: **$313,43**. Todos los despachos coinciden con su deuda en el sistema; no hay ningún monto inflado.
- **Qué falta:** el pago de $313,43 no está registrado. Si el cliente lo hizo, hay que buscar el comprobante y cargarlo. Ojo: el 16-nov hay un pago de **$311,57** (referencia 59rfy). Conviene confirmar con el banco que ese pago no era en realidad de $313,43; si fue así, faltarían solo $1,86 y no $313,43.

### 3. KIA 241 — debe $64,50 (diferencia de intercambio en el despacho #3596)
- El 02-oct-2026 el cliente cambió 10 cabillas de 12 mm × 6 m ($64,50) por 10 cabillas de 12 mm × 12 m ($129). La diferencia a pagar era **$64,50**.
- La pantalla de devoluciones tiene una opción para **cobrar la diferencia en el momento**. Si no se llena, el sistema la deja como deuda. En este caso **no se llenó**, así que quedó como deuda de $64,50.
- **Qué falta:** si el cliente pagó esa diferencia, registrar el pago de $64,50 con su método y referencia.

### 4. Albert Omar Ruiz Ávila — debe $60,59 (resto del despacho #3262)
- El despacho #3262 fue a crédito por **$734,50**.
- El 29-sep se registraron dos pagos: **$414,50** en USDT ("PAGO DEL VIERNES"). Con eso le faltaban exactamente **$320**.
- Cinco minutos después se registró un pago móvil de **$259,41** con referencia **"261114 COMPROBANTE PAGO 2 DEUDAS"**.
- **Ese mismo comprobante 261114** se usó un minuto antes para pagar **$698,50** a **Carlos Pacheco**, que quedó en $0.
- **Conclusión probable:** el comprobante 261114 era por **$1.018,50** ($698,50 de Carlos + $320 de Albert), y al repartirlo a Albert se le anotaron $259,41 en lugar de $320. La diferencia es **$60,59**. Para confirmarlo hay que ver el monto del comprobante en el banco.
- **Hoy (23-nov)** la administradora registró un "Cruce" de $60,59 a las 8:59 a. m. (hora de Venezuela) con la nota "LO ACTUALIZO Y SE VUELVE A COLOCAR", y lo revirtió a las 9:25 a. m. Por eso vuelve a aparecer la deuda.
- **Qué falta:** si el comprobante dice $1.018,50, registrar $60,59 como **"Transf. / Pago Móvil"** con referencia "261114 (diferencia)", no como "Cruce", para que el método coincida con el dinero que realmente entró.

## Pasos para la administradora (por cada cliente)

1. Tener a mano el comprobante (o la nota del cruce).
2. Abrir **Clientes**, buscar el cliente y abrir su **ficha**.
3. En **"Registrar abono"**, poner el monto exacto, el **método** real (Zelle, USDT, Pago Móvil, Cruce…) y la **referencia** del comprobante.
4. En la descripción, escribir el despacho que paga, por ejemplo "PAGO FACT 3347".
5. Pulsar **"Confirmar abono" una sola vez** y esperar. El sistema todavía no protege contra registros duplicados (ver OP-2026-038, falla G4). Si da error, **revisar el historial antes de volver a intentarlo**.

## Relación con la auditoría de código (OP-2026-038)

- Ninguno de los 4 casos es causado por un error de cálculo. Son pagos que no se cargaron.
- KIA muestra una mejora útil: al registrar un intercambio con diferencia a pagar, la pantalla debería **preguntar** "¿el cliente pagó la diferencia ahora?" en lugar de dejarla como deuda sin avisar.
- Albert muestra otra: cuando **un comprobante paga a varios clientes**, sería útil que el sistema avisara si la referencia ya se usó y mostrara cuánto queda por repartir.

## Pendiente / sin verificar

- Confirmar en el banco el monto del comprobante 261114 (Albert / Carlos Pacheco).
- Confirmar si el pago de $311,57 del 16-nov de Yahveh fue en realidad de $313,43.
- Confirmar contra qué se hizo el cruce de $850 de Constructora Ew 2010.
- Confirmar el pago de la diferencia de KIA 241 (método y referencia).
- Los 4 pagos los debe registrar administración. Este caso solo diagnostica.
