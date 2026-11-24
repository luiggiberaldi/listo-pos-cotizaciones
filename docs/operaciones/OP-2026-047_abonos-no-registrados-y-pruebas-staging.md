# OP-2026-047 — Abonos "pagados" que no aparecen (Yahveh y otros) y prueba completa del registro de abonos en staging

- **Fecha:** 2026-11-23
- **Pedido por:** luigi (video de WhatsApp + captura de la ficha de Yahveh)
- **Tipo:** revisión de producción (solo lectura) + pruebas en staging
- **Estado:** revisión y pruebas terminadas; nada se cambió en producción. Las fallas nuevas pasaron al [registro de fallas](REGISTRO-FALLAS-CODIGO.md).

## En resumen

- **El pago de $313,43 de Yahveh nunca se registró en el sistema.** No está en ningún cliente, en la auditoría, en el registro de errores ni en staging. En el video, la propia empresa responde al cliente *"Este no me lo han confirmado"*: el pago de Binance todavía no se había confirmado y por eso nadie lo cargó.
- Lo mismo con los otros marcados "Pago" en la hoja impresa: **KIA 241 ($64,50)** no tiene ningún intento registrado, y **Albert Ruiz ($60,59)** se registró hoy como "Cruce" con la nota *"LO ACTUALIZO Y SE VUELVE A COLOCAR"* y **se revirtió a mano 26 minutos después**.
- **El sistema no "devuelve" abonos por su cuenta.** Ningún proceso automático ni función de la base borra abonos. Solo desaparecen por:
  1. alguien que pulsa **Revertir**,
  2. **reabrir o anular** un despacho (borra su deuda y deja el pago suelto, o borra lo enlazado en el camino viejo),
  3. editar un despacho que tenía consumo de saldo a favor o vuelto.
- **Pruebas en staging del registro de abonos:** la mayoría de los casos funcionan, pero se confirmaron fallas reales. Si el abono falla, **la pantalla no avisa nada** y el operador puede creer que se guardó. Un doble clic guarda **dos abonos**, dos personas al mismo tiempo pueden dejar al cliente **pagado de más**, y reabrir un despacho pagado con un abono suelto **deja el pago flotando**. Además, el servidor no compara el detalle del pago con el monto.

## Parte 1: los abonos que no aparecen

### Lo que muestra el video

- Chat de WhatsApp con YAHVEH, C.A. El cliente reenvía un comprobante de Binance **"Pago exitoso 313.43 USDT"** a "Construacero Carabobo" (4:35 p. m.) y escribe "al día, sin cuentas por pagar".
- La empresa responde (4:37 p. m.): **"Este no me lo han confirmado"** y "El dueño me dice que por ser de la…".
- Después se ve el reporte de CxC impreso con marcas a mano: **"Pago"** junto a Yahveh, KIA 241 y Albert Omar Ruiz Avila; **"Act."** junto a Alejandra Hidalgo y Lerwis Pinto (sus abonos por descuento de nómina sí se registraron hoy); "Láminas" junto a Enrique Chirino.

### Lo que hay en producción

| Cliente | Deuda | ¿Hay abono? | ¿Hubo algún intento? |
|---|---|---|---|
| Yahveh | $313,43 | No | No. Su último abono es del 20-nov ($235, Zelle 41PRV) |
| KIA 241 | $64,50 | No | No hay nada en la auditoría |
| Albert Ruiz | $60,59 | No | Sí: registrado hoy a las 12:59 como "Cruce" y **revertido a mano** a las 13:25 |
| Constructora Ew | $850 | No | No (caso de OP-039) |

- Se buscó un movimiento de $313,43 en toda la base, en la auditoría, en el registro de errores (`system_logs`) y en staging (por si se registró en la copia de pruebas por error). **No existe en ningún lado.**
- Los abonos de hoy de Lerwis Pinto y Alejandra Hidalgo que aparecen en staging son copias de producción (mismo número interno), no registros hechos allí por error.

**Conclusión:** no es el sistema perdiendo abonos. Son pagos que **no se registraron** porque estaban esperando confirmación del dueño, o que se registraron y **se revirtieron a mano** (Albert Ruiz).

## Parte 2: ¿qué puede borrar o deshacer un abono? (lectura del código)

| Dónde | Qué borra | Cuándo |
|---|---|---|
| Botón **Revertir** (`handleRevertirAbono`) | El abono elegido | Solo a mano (administración, jefe o desarrollador) |
| **Reabrir o anular** un despacho entregado (`revertir_entrega_finanzas_atomica`) | Todo lo enlazado al despacho | Solo si no tiene cobros enlazados; los pagos **sueltos** no los ve (G2) |
| **Anular** desde "despachada" (camino viejo, `despachos.js` 4b) | Todo lo enlazado al despacho, **incluso cobros reales** | Si la operación no usa el camino nuevo (G2) |
| **Edición profunda** de un despacho | Su cargo, su consumo de saldo a favor o su crédito por vuelto | Si cambia la forma de pago o desaparece el vuelto |
| `factory_reset_operacional`, `tester_cleanup_cotizacion` | Todo de una cuenta, o de despachos de prueba | Herramientas de mantenimiento |

**No hay ningún proceso automático** (tareas programadas, disparadores de la base) que borre abonos.

## Parte 3: prueba completa del registro de abonos en staging

Cliente temporal **"PRUEBA OP047 ABONOS"** con un despacho entregado a crédito por $634, y un operador temporal de administración. Las pruebas se hicieron contra el servidor y en un navegador real (Chromium). Todo se borró al terminar.

### Registro (directo al servidor)

| # | Caso | Resultado |
|---|---|---|
| A1 | Abono normal de $100 | ✅ Se guarda, la deuda baja a $534 y queda en la auditoría |
| A2 | Monto cero o negativo | ✅ Se rechaza ("Monto inválido") |
| A2 | Monto en texto ("abc") | ⚠️ No se guarda, pero el servidor responde con un error técnico (500) en vez de un mensaje claro |
| A3 | Abono mayor que la deuda | ✅ Se rechaza con mensaje claro |
| A4 | Dos formas de pago (Zelle $50 + Efectivo $30) | ✅ Se guarda |
| A5 | Abono de $40 cuyo detalle de pago solo suma $10 | ❌ **Se acepta**: el servidor no compara el detalle con el monto |
| A6 | Decimales ($0,10 + $0,20) | ✅ Exactos |
| A7 | Misma petición dos veces a la vez, **sin** clave de operación (lo que manda hoy la ficha) | ❌ **Se guardan 2 abonos** (G4) |
| A8 | Reintento **con** clave de operación | ✅ Se guarda 1 |
| A9 | Dos operadores abonan el saldo completo al mismo tiempo | ❌ **Se aceptan los dos**: el cliente queda pagado de más (I2) |
| A10 | Sin sesión de operador, o con sesión vencida | ✅ Se rechaza |
| A11 | Abono a un despacho de otro cliente | ✅ Se rechaza (arreglo de OP-042) |

### ¿Algo deshace el abono después?

| # | Caso | Resultado |
|---|---|---|
| B1 | Recalcular el saldo del cliente | ✅ El abono sigue |
| B2 | Reabrir un despacho pagado con un abono **enlazado** | ✅ El sistema **no deja** reabrirlo ("tiene cobros reales… anule los cobros primero") |
| B2 | Reabrir un despacho pagado con un abono **suelto** desde la ficha (lo normal) | ❌ **Lo deja reabrir:** la deuda se borra y el pago queda flotando como "pagado de más $634" (G2) |
| B3 | Revertir un abono | ❌ La fila se borra y la auditoría solo guarda el monto (sin método ni referencia) (I3) |

### En la pantalla (navegador real)

| # | Caso | Resultado |
|---|---|---|
| 1 | Abono correcto | ✅ Se guarda y aparece "Abono registrado exitosamente" |
| 2 | El servidor falla (sesión vencida, error interno, sin conexión) | ❌ **Ningún mensaje de error.** No se guarda nada, el monto sigue escrito y el botón vuelve a "Confirmar abono". En staging, además, sigue visible el verde "Abono registrado exitosamente" del abono anterior (ver N10 y N11) |
| 3 | Doble clic rápido en "Confirmar abono" | ❌ **Se guardan 2 abonos** (G4) |

### Por qué el operador no se entera de que el abono falló

- **En producción y en staging (N10):** el formulario de abono (`FichaClienteModal.jsx`, `handleSubmit`) espera la respuesta del servidor sin manejar el error, y el registro del abono (`useRegistrarAbono` en `useCuentasCobrar.js`) no tiene aviso de error. Tampoco hay un aviso general en la aplicación. Si el servidor rechaza o falla (sesión vencida, conexión caída, monto mayor que la deuda), **no aparece ningún mensaje**: el error solo queda en la consola del navegador, que el operador no ve, y no se guarda en la auditoría ni en el registro de errores. Lo mismo pasa con "Cargar saldo a favor" y "Devolución de saldo".
- **Solo en staging (N11):** el componente de mensajes (`Toast.jsx`) usa un número interno para crear el mensaje y otro distinto para programar su borrado, así que **los mensajes nunca se borran solos**. Después de un abono correcto, el verde "Abono registrado exitosamente" se queda en pantalla, y si el siguiente intento falla parece que también se guardó. **Producción ya tiene este defecto corregido**: la copia de staging tiene una versión más vieja de ese archivo.
- **Cómo se nota en producción:** después de un abono correcto, el formulario se vacía. Si el monto **sigue escrito** después de pulsar "Confirmar abono", el abono **no** se guardó.

## Fallas nuevas (agregadas al registro)

- **N8 — El detalle del pago no se compara con el monto** (A5).
- **N9 — Un monto inválido devuelve un error técnico** en vez de un mensaje claro (A2).
- **N10 — Si el abono falla, la pantalla no avisa** (en producción y en staging).
- **N11 — En staging los mensajes no se borran solos** (producción ya está corregida; staging tiene una versión vieja de `Toast.jsx`).
- Confirmadas con prueba real: **G2** (reabrir con abono suelto), **G4** (doble clic), **I2** (dos operadores a la vez) e **I3** (revertir borra).

## Recomendaciones de proceso (no son cambios de código)

- Registrar el abono **cuando se confirma** el pago y avisar al cliente solo después. Si el pago está "por confirmar", anotarlo en algún lado (por ejemplo, en la descripción) para que no se pierda.
- No marcar a mano "Pago" en el reporte impreso sin registrar el abono en el sistema.
- Antes de **revertir**, escribir el motivo, porque hoy la reversión no guarda el detalle.

## Cómo se hizo (técnico)

- Producción (solo lectura): `cuentas_por_cobrar`, `auditoria` y `system_logs`, más una búsqueda de funciones de la base que borran movimientos (`op047_borradores.py`).
- Video: se extrajeron imágenes con OpenCV (en `.tmp-op040/op047/`, ignorado por git).
- Staging: `escenario047.py` (crea y limpia el cliente temporal), `scripts/op042-operador-prueba.mjs` (operador temporal), `scripts/op047-abonos-api.mjs` (casos A y B), `scripts/op047-reabrir.mjs` (reabrir con abono enlazado y con abono suelto) y `scripts/op047-abonos-pantalla.mjs` (navegador real; capturas en `tmp/op047/`, que no se suben).
