# Informe: por qué no deja registrar el pago COD de DES-04099

**Fecha:** 20 de octubre de 2026
**Caso:** despacho DES-04099 (número interno #4099), cliente Inversiones Ferrefrio V&D
**Tipo de informe:** diagnóstico de una pantalla que bloquea un cobro (solo lectura; no se cambió nada)

---

## En resumen

1. **No es un error ni están mal tus datos.** DES-04099 es un pedido de **pago partido**: la mitad a crédito ("Cta por cobrar") y la otra mitad por cobrar en la entrega ("Cobro a destino" / COD). El módulo de cobros COD **se niega por diseño** a registrar pagos en pedidos partidos, para que el dinero nunca se acredite a la deuda equivocada.
2. **El dinero de este cobro sí se puede registrar hoy**, con una pequeña maniobra que yo puedo hacer en minutos si me das el visto bueno y los datos del pago (cómo pagó el cliente, referencia y quién lo recibió). Ojo: registrarlo como un abono común de cuenta **sí guarda el dinero, pero dejaría la comisión congelada** — no recomiendo ese atajo.
3. **De fondo hace falta una mejora pequeña** al módulo COD para que estos pedidos partidos funcionen con el botón normal. Es un caso que se va a repetir: ya hay 5 pedidos así en la historia (2 de ellos solo de hoy, los dos del mismo cliente).

---

## 1. Qué significa lo que se ve en pantalla

El recuadro "Conciliar COD — DES-04099" dice, en criollo:

| En pantalla | Significado |
|---|---|
| **Saldo COD del ledger: $1.076,79** | El sistema contable dice que de la parte "cobrar en entrega" de este pedido **aún no ha entrado ni un dólar**. |
| **Estado derivado: manual_review** | "Hay una diferencia que una persona debe revisar". El sistema prefiere bloquearse antes que registrar algo dudoso. |
| **"No se usa el flag antiguo como comprobante"** | El sistema ya no cree en la casilla "pagado" de antes; ahora solo cree en los movimientos de dinero registrados. (Esto es a propósito: era la fuente de los descuadres antiguos.) |
| **"No se puede registrar un pago automático hasta resolver la discrepancia"** | El botón de cobro está apagado hasta que un humano aclare el caso. |
| **Cargos COD $1.076,79 · abonos $0,00** | La parte COD del pedido fue por $1.076,79 y no tiene ningún pago registrado. |

## 2. Por qué se bloquea (la regla exacta)

Cuando el sistema lee un pedido, mira su **libro de cuentas** (los "cargos" que generó el pedido y los "abonos" de pagos recibidos). Para poder registrar un cobro COD de forma segura exige que **todo el pedido sea COD**. En DES-04099 el libro tiene **dos cargos distintos**:

| Cargo en el libro | Método | Monto |
|---|---|---|
| Orden de despacho #4099 (Crédito) | Cta por cobrar | $1.076,19 |
| Orden de despacho #4099 (COD) | Cobro a destino | $1.076,79 |

Como el pedido tiene cargos de **dos clases**, el sistema no puede saber por sí solo a cuál de las dos deudas corresponde el dinero que llega… y en lugar de adivinar, **bloquea**. Es el mismo comportamiento de un cajero que recibe un pago sin indicar a cuál de dos facturas aplicarlo: prefiere no aplicarlo a aplicarlo mal.

Ojo: esto pasa **solo** cuando el pedido es "parte a crédito + parte por cobrar en entrega". Si el pedido es 100% COD, o COD + un pago inmediato (efectivo, transferencia, Zelle…), el botón funciona con normalidad — de hecho hoy mismo se registró así el cobro del pedido #4062 (Zelle + COD) sin ningún problema, porque ese pedido no tenía parte a crédito.

## 3. ¿Están mal los datos de DES-04099?

**No.** Verifiqué el pedido completo contra el sistema real (solo lectura) y todo cuadra:

- El pedido está **entregado** (20 de octubre), total $2.152,98.
- Su forma de pago declarada es exactamente: $1.076,19 a crédito + $1.076,79 por cobrar en entrega.
- El libro tiene los dos cargos por esos mismos montos, sin pagos todavía.
- Las casillas antiguas de "pagado" están en falso y no hay movimientos raros.

Es decir: **no hay nada que "arreglar" en el pedido**. Lo que hay es un hueco del módulo de cobros: no sabe atender pedidos partidos.

## 4. Alcance: ¿a cuántos pedidos les pasa?

Pedidos con "parte a crédito + parte COD" (los que hoy quedan bloqueados para el botón de cobro):

| Pedido | Cliente | Parte COD | Parte crédito | Pagos registrados |
|---|---|---|---|---|
| #2832 | ALBERT OMAR RUIZ AVILA | $0,10 | $15,90 | ✅ todo pagado ($16,00) |
| #3064 | Angel Pineda | $2.000,00 | $2.187,78 | ⚠️ parcial ($2.246,28) |
| #3879 | Ferretería El Punto Amarillo | $490,00 | $5.308,75 | ✅ cobrado, pero **anotado a nivel de cuenta** (ver nota abajo) |
| #4098 | Inversiones Ferrefrio V&D | $3.728,00 | $3.728,00 | ❌ nada |
| **#4099** | **Inversiones Ferrefrio V&D** | **$1.076,79** | **$1.076,19** | ❌ nada |

Lo que **no se ha cobrado** de la parte COD: **$4.804,79** (#4098 + #4099), más el resto del pago parcial de #3064. Notas: #4098 y #4099 son del mismo cliente y **se despacharon y entregaron hoy mismo, 20 de octubre** — el patrón "mitad crédito, mitad COD" viene de las condiciones que este cliente negocia, y se puede repetir.

**Caso #3879 (corrección de este informe):** su cobro COD de $490 **sí se hizo** (por USDT, el 13 de octubre). Como el botón estaba bloqueado, el operador lo anotó como abono a nivel de cuenta el 16 de octubre con la referencia literal **"pago el 13 sistema no lo tomo"**, y alguien marcó "pagado" a mano. Es la prueba viviente de que el bloqueo ya está provocando trabajo manual fuera del sistema. Ese cobro solo hay que **ligarlo al pedido** (con evidencia) para dejar todo en orden — es uno de los pendientes que la [propuesta de solución](../plans/2026-10-20-plan-cod-pagos-multiples-e2e.md) incluye.

## 5. Qué hacer hoy (tres caminos)

### Opción 1 — Regularización con evidencia (recomendada para #4099)
Yo registro el cobro de $1.076,79 con el **mismo procedimiento completo** que usa el botón (dinero en el libro + marca de cobrado + liberación de la comisión + registro de auditoría), pero indicando a mano que es la parte COD. Necesito de ti:
- Cómo pagó el cliente (efectivo $, efectivo Bs, Zelle, transferencia, punto de venta, USDT),
- la referencia del pago (número de recibo o de operación),
- quién recibió el dinero y cuándo.

Queda con respaldo previo y deshacible. Puedo hacer lo mismo con #4098 cuando se cobre. (El #3879 no necesita cobrarse: su dinero ya entró; solo hay que ligar ese abono al pedido.)

### Opción 2 — Abono común de cuenta (funciona, pero incompleto)
Desde la ficha del cliente se puede registrar el dinero como "abono" normal ligado al pedido (así se pagaron varios pedidos parecidos antes). **El dinero queda bien registrado**, pero:
- la **comisión del vendedor quedaría congelada**, porque el sistema la libera al ver la marca de "cobro a destino pagado" y este atajo no la pone, y
- la pantalla seguiría mostrando "manual_review" (solo como aviso; el saldo COD quedaría en $0,00).

Por eso solo la recomiendo si no hay tiempo para la Opción 1.

### Opción 3 — No hacer nada por ahora
El pedido sigue con su deuda clara y bien registrada (no se pierde ni se corrompe nada). Pero el cobro queda sin formalizar y la comisión congelada hasta resolverlo.

**Lo que NO hay que hacer:** editar la forma de pago del pedido para quitar la parte COD y convertirlo todo en crédito. Eso deformaría el historial y crearía el tipo de descuadres que este sistema justamente fue diseñado para eliminar.

## 6. Qué propongo de fondo (para que no siga pasando)

Una mejora acotada al módulo COD (pantalla + dos funciones de base de datos), que sería un "release" menor con sus pruebas y su plan de deshacer:
- que el botón de cobro COD **sí funcione** en pedidos "parte a crédito + parte COD", aplicando el dinero **solo a la parte COD** (el sistema ya muestra ambas partes por separado, así que la información está),
- manteniendo el bloqueo actual para los casos verdaderamente ambiguos (donde ni el sistema ni un humano pueden saber a qué corresponde el pago).

Si me das el "sí", lo preparo con pruebas en una base de pruebas antes de tocar producción, igual que el resto de cambios.

## 7. Cómo se hizo este diagnóstico (transparencia)

- **Solo lectura:** no se modificó nada en producción. Se consultaron el pedido, su libro de cuentas, la forma de pago y el estado del cliente.
- Se reprodujo, paso por paso, la regla real que usa el sistema (función `resumen_financiero_despacho`, en producción desde el 18 de octubre) contra los datos reales del pedido, y el resultado coincide exactamente con lo que muestra la pantalla.
- Se comprobó también el camino contrario: la función que registra cobros COD rechaza este mismo pedido con el error "ledger ambiguo" (es decir, el botón no es solo una pantalla amable: el fondo también protege).
- Se verificó cuántos pedidos comparten la misma condición (los 5 de la sección 4) y cómo se pagaron los parecidos en el pasado.

---

### Anexo técnico (para el equipo de sistemas)

- **Regla que dispara el bloqueo:** en `public.resumen_financiero_despacho(uuid,uuid)` (release 14, `supabase/release/main/14_cod_financial_rpcs_apply.sql`): `ELSIF v_cargo_cod<=0 OR abs(v_cargos-v_cargo_cod)>0.01 THEN v_estado := 'manual_review'`. Para DES-04099: cargos totales $2.152,98 vs cargos COD $1.076,79 → diferencia $1.076,19 → `manual_review`.
- **La misma guarda en el registrador:** `registrar_pago_externo_cobro_idempotente(...)` lanza `COD_CONCILIACION_LEDGER_AMBIGUO` con la condición equivalente, por lo que forzar la llamada tampoco funciona (y no debe forzarse).
- **La pantalla** (`src/components/despachos/ConciliarCodModal.jsx`) solo habilita el formulario con estados `pendiente`/`parcial`; con `manual_review` el botón queda deshabilitado por diseño.
- **Lo que hace el flujo atómico al cobrar** (esto es lo que replicaría la regularización): 1) inserta el abono en `cuentas_por_cobrar` con `metodo_pago='cod'` y la evidencia en la descripción; 2) actualiza `forma_pago` y `forma_pago_cliente` (marca `cobro_destino_pagado`, `conciliado_sin_abono=false`, `metodos_pagados`, `conciliado_en`, `evidencia_pago`); 3) deja auditoría `COD_CONCILIADO_CON_EVIDENCIA`; 4) si el COD quedó saldado, llama `recalcularcomisiondespacho_238b` para liberar la comisión.
- **Dependencia de comisiones:** `calcularcomisiondespacho_238b` y `comision_238b_cod_pendiente` leen el flag `cobro_destino_pagado` (no el libro). Por eso el abono común de cuenta (Opción 2) no libera la comisión.
- **Precedente funcional:** pedido #4062 (declaró Zelle + COD; su libro solo tenía el cargo COD porque el resto fue pago inmediato) cobrado hoy 20/10 14:13 UTC por el flujo atómico vía el propio botón: $49,51 por Zelle, referencia H6Y2M, evidencia "NIKI", y su JSON quedó marcado `cobro_destino_pagado: true` — el flujo normal **sí funciona** cuando no hay cargo a crédito en el mismo pedido.
