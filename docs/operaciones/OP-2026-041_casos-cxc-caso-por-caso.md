# OP-2026-041 — Estudio caso por caso de los clientes de CxC (en staging)

**Fecha:** 23 de noviembre de 2026
**Tipo:** revisión y simulación. Los datos se estudiaron en **staging** (la copia de [OP-2026-040](OP-2026-040_copia-clientes-cxc-a-staging.md)). El historial de cambios (auditoría) se leyó en producción, **solo lectura**.
**Cambios hechos:** ninguno que quede guardado. Las correcciones se simularon en staging y **se deshicieron solas** al terminar: se comprobó que quedaron 0 filas de prueba.
**Corrige a:** [OP-2026-037](OP-2026-037_auditoria-reporte-carteras-abonos-cod.md) y [OP-2026-038](OP-2026-038_auditoria-codigo-cxc.md) en lo que dicen de los "$4.969,71 en pagos de más escondidos".

## En resumen

- **De los $4.969,71 "escondidos", $3.318,69 ya tienen explicación clara**, y no son dinero perdido:
  - **$1.014,03 (11 clientes) son registros viejos de clientes que pagaron con su saldo a favor.** Antes de una corrección de agosto, ese pago se anotaba también como pago de deuda. La corrección se aplicó a los pagos nuevos, pero los 13 registros viejos de julio y agosto quedaron como estaban. Es como un recibo archivado en la carpeta equivocada: el dinero está bien, pero la cuenta de deudas lo ve como un pago.
  - **$1.949 de Decoraciones Encendo:** la devolución de 279 sacos de cemento y un "Cruce – NO PROCEDE" hecho a mano cancelaron **dos veces** el mismo crédito. Sobra el Cruce.
  - **$356 de Carlos Escalona:** se registró como abono un dinero que ya estaba contado dentro del efectivo del despacho #533.
- **Ojo, esto sí tiene efecto:** esos registros sobrantes **se comen en silencio las próximas compras a crédito** del cliente. Ya pasó una vez: a Ferretería El Gran Adonay se le escondió una deuda real de **$0,34** (despacho #4807 del 18-nov). Ferrechuros tiene **$810** que se comerían su próxima compra a crédito. En OP-2026-037 se dijo que Ferrechuros "no tenía impacto", y eso **estaba mal**.
- **Quedan $1.651,02 sin explicar:** Adalberto Rojas ($1.051), A_40 ($600) y $0,02 de pruebas de Beatriz Landadeta. Son abonos de mayo que no corresponden a ninguna compra a crédito. Lo más probable es que fueran deudas del sistema anterior. **Solo administración lo puede confirmar.**
- **REYKAR sigue sin resolverse** con los datos, y aparece una pista nueva (ver abajo).
- **Simulación:** si se aplican las correcciones claras y los 4 pagos de OP-2026-039, el dinero escondido baja de **$4.969,71 a $1.651,02**. Decoraciones Encendo pasa a deber **$195** (su deuda real) y El Gran Adonay **$0,34**. Ningún saldo a favor cambia.

## Caso por caso

| Cliente | Qué pasó (comprobado) | Corrección propuesta | Quién decide |
|---|---|---|---|
| **Decoraciones Encendo** | El 27-jul a las 11:53 a. m. se registró a mano un "Cruce – NO PROCEDE" de $2.144 contra el crédito del despacho #1863. A las 4:03 p. m. se registró la devolución formal de 279 sacos de cemento ($2.148,30, motivo "cantidad incorrecta", destino "saldo a favor"). Como el sistema no veía el Cruce manual (falla G1 de OP-038), aplicó $2.144 de la devolución **otra vez** contra ese crédito y solo $4,30 a saldo a favor | **Revertir el abono "Cruce – NO PROCEDE" de $2.144.** Resultado: debe $195 (despacho #1954, real) y conserva $4,30 a favor | Administración (confirmar) |
| **Carlos Escalona** | Despacho #533 ($956, 18-may): primero se cargó como $600 en efectivo + $356 a crédito. A las 12:48 p. m. se registró un abono de $356 en efectivo. A las 3:43 p. m. el despacho se editó a "$956 todo en efectivo". Los $356 quedaron contados dos veces | **Revertir el abono de $356**, después de confirmar con caja que ese día entraron $956 y no $1.312 | Caja / administración |
| **11 clientes con pagos viejos con saldo a favor** (Ferrechuros $810, Jonny Espinoza $66,25, Jesús Chirinos $37,50, Ernesto Castilla $31,50, Georgina Gómez $24,38, Leidy Contreras $15,75, Héctor Jordan $9,57, El Gran Adonay $8,10, Dayimar Mercado $5,50, Manuel Veliz $3,38, Anthony Ruiz $2,10) | 13 registros del 03-jul al 06-ago con la descripción "Pago con Saldo a Favor". Se guardaron como "abono" (pago de deuda), pero eran el uso de un saldo a favor al pagar un despacho de contado. Desde la corrección de agosto, ese uso se guarda con su propio tipo ("consumo de saldo a favor"), que no toca la deuda. Solo se arregló entonces el caso de Rosa Sánchez ([runbook de agosto](../plans/2026-08-28-runbook-promocion-04-consumo-credito.md)) | **Pasar esos 13 registros al tipo correcto.** No cambia ningún saldo a favor. Solo El Gran Adonay pasa a deber sus $0,34 reales | luigi (es una corrección de datos en producción) |
| **Adalberto Rojas** | 4 abonos en efectivo del 13 y 14 de mayo ($500, $51, $250 y $250), registrados por ADMINISTRADOR. No tiene ninguna compra a crédito. Sus despachos #233 ($195) y #259 ($1.717) siguen "pendientes" desde mayo y nunca generaron deuda. Hay **dos abonos iguales de $250** el mismo día, con 4 horas de diferencia | Preguntar: ¿eran deudas del sistema anterior? Si sí, cargar esa deuda vieja. Si no, revertir los abonos. Confirmar si los dos de $250 fueron dos pagos | Administración |
| **A_40** | Abono de $600 en efectivo el 18-may, sin ninguna compra a crédito. Su primer despacho es de julio. El 21-may se le asignó por un rato un despacho de $948,60 que luego se anuló y ya no existe | Igual que Adalberto: confirmar el origen | Administración |
| **Beatriz Landadeta** | Dos abonos de $0,01 con la nota "Abono de prueba temporal" (11-jun) | Revertir los dos (son pruebas) | Administración |
| **REYKAR** | Los dos abonos de $1.000 del 05-oct ("ENZO CONFIRMO", 32 segundos de diferencia) siguen sin poder confirmarse. **Pista nueva:** el 30-oct se registró "PAGO TOTAL REYCAR" por $6.026,50, pero después de ese pago el sistema sigue marcando **$748,46** de deuda. Si hubo un duplicado, la deuda real sería $1.748,46. Ninguna de las dos cifras da $0 | Preguntar a caja: ¿con qué cuenta llegaron a los $6.026,50 del "pago total"? ¿Fueron uno o dos pagos de $1.000 el 05-oct? | Caja / Enzo |
| **Albert Ruiz, KIA 241, Constructora Ew 2010, Yahveh** | Sin novedades respecto de [OP-2026-039](OP-2026-039_clientes-reportados-como-pagados.md): los pagos nunca se registraron | Registrar los 4 pagos con comprobante. La simulación confirma que cada uno queda en $0 | Administración |

## Resultado de la simulación en staging

Se aplicaron juntas, dentro de una operación que se deshace al final: las correcciones de Decoraciones Encendo y Carlos Escalona, el cambio de tipo de los 13 registros viejos y los 4 pagos de OP-2026-039.

| | Antes | Después |
|---|---|---|
| Dinero escondido (pagos de más), en toda la base | $4.969,71 | **$1.651,02** (Adalberto, A_40, Beatriz) |
| Decoraciones Encendo | debe $0, oculto $1.949 | **debe $195**, oculto $0, a favor $4,30 (igual) |
| El Gran Adonay | debe $0, oculto $7,76 | **debe $0,34**, oculto $0 |
| Ferrechuros y los otros 9 de saldo a favor | oculto entre $2,10 y $810 | oculto $0, mismos saldos |
| Carlos Escalona | oculto $356 | oculto $0 |
| Albert / KIA / Ew 2010 / Yahveh | deben $60,59 / $64,50 / $850 / $313,43 | deben $0 |
| REYKAR | debe $748,46 | sin cambio (falta la respuesta de caja) |
| Saldos a favor | — | **ninguno cambia** |

## Qué significa para ti

- **No falta dinero en caja por estos casos.** Son registros mal clasificados o duplicados en el sistema, no pagos perdidos.
- **El riesgo real es hacia adelante:** mientras no se corrijan, si Ferrechuros, Adalberto, A_40 o los demás compran a crédito, el sistema les va a mostrar una deuda más baja de la real.
- **Lo que debe hacer administración:**
  1. Confirmar y revertir el "Cruce – NO PROCEDE" de Decoraciones Encendo.
  2. Confirmar con caja el efectivo del despacho #533 y revertir el abono de $356 de Carlos Escalona.
  3. Responder de dónde salen los abonos de mayo de Adalberto Rojas y A_40.
  4. Responder las dos preguntas de REYKAR.
  5. Registrar los 4 pagos de OP-2026-039.
- **Lo que debe decidir luigi:** autorizar el cambio de tipo de los 13 registros viejos en producción. Es una corrección de datos pequeña y verificable, ya probada aquí. No conviene hacerla a mano desde la pantalla.

## Cómo se hizo (detalle técnico)

- Movimientos y despachos leídos en staging (copia idéntica de OP-2026-040). La tabla `auditoria` se leyó en producción, solo lectura: ediciones de pago de despachos (`EDITAR_PAGO_DESPACHO`), cambios de estado y ventas.
- Registros viejos: `tipo='abono' and forma_pago_abono='Saldo a favor' and descripcion ilike 'Pago con Saldo a Favor%'` → 13 filas, $1.014,03. La corrección es pasarlas a `consumo_credito`. La fórmula del saldo a favor ya resta igual los dos tipos, por eso ese saldo no cambia. El "Cruce de saldo a favor contra deuda" ($150,90, 11-sep) es un pago de deuda legítimo y **no** se toca.
- Simulación: [`simular_op041.py`](OP-2026-040_scripts/simular_op041.py). Corre dentro de un bloque que termina con un error a propósito, para que la base deshaga todo. Las reglas automáticas de saldo sí se dispararon, así que el resultado es realista. Comprobación posterior: 0 filas de simulación en staging.
- Diferencia de cartera en la simulación: −$1.288,52 (los 4 pagos) + $195 (Encendo) + $0,34 (El Gran Adonay) = **−$1.093,18**. Cuadra con lo observado.

## Pendiente / sin verificar

- Todas las respuestas de administración y caja de la tabla de arriba.
- Autorización de luigi para corregir los 13 registros viejos en producción. Se haría como un caso propio, con respaldo y verificación.
- REYKAR: no se pudo determinar si hubo un pago duplicado.
- Nada de esto cambia el plan de código de OP-2026-038. El paso 1 (mostrar los pagos de más) haría visibles estos casos en la pantalla.
