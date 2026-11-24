# OP-2026-048 — Plan para arreglar las 26 fallas en staging, con pruebas y reporte de clientes

- **Fecha:** 2026-11-23
- **Pedido por:** luigi
- **Tipo:** plan — **ejecutado completo en staging el 2026-11-24** (casos OP-2026-049 a OP-2026-058; cierre y resultados en [OP-2026-058](../operaciones/OP-2026-058_prueba-final-y-reporte-clientes.md)). Durante la ejecución aparecieron 4 fallas más (N12 a N15): el registro quedó en 30. Producción sigue sin cambios.
- **Alcance:** solo **staging** (la copia de pruebas). Pasar a producción será un caso aparte, con su propia aprobación.
- **Base:** [registro de fallas del código](../operaciones/REGISTRO-FALLAS-CODIGO.md) (26 fallas) y los casos OP-2026-038 a OP-2026-047.

## En resumen

- Las 26 fallas se arreglan en **7 fases**, empezando por las que hacen **perder o esconder dinero**: abonos que fallan sin avisar, duplicados y pagos que quedan flotando al anular.
- Cada fase termina con **pruebas propias** y, al final, se corre **todo junto**: pruebas automáticas, pruebas contra el servidor y pruebas en navegador real. Nada pasa a la siguiente fase si algo queda en rojo.
- **Arreglar el código no cambia por sí solo la deuda de ningún cliente.** Lo que cambia es que los errores **dejan de repetirse** y que lo escondido **se ve**. Las deudas solo cambian cuando administración **aprueba** las correcciones de datos de cada caso.
- Al terminar se entrega un **reporte cliente por cliente** con tres columnas: cómo está hoy, cómo se ve con el código arreglado y cómo quedaría si se aprueban las correcciones. Abajo va una **proyección preliminar** con lo que ya sabemos.

## Cómo se va a trabajar (reglas)

1. **Todo en staging.** Ninguna fase toca producción. Para leer producción se usa solo el modo de solo lectura (scripts de OP-2026-040).
2. **Una fase a la vez**, cada una con:
   - prueba que **reproduce** la falla antes del arreglo (en rojo),
   - el arreglo,
   - la misma prueba **en verde**,
   - las pruebas de todo lo anterior otra vez, para confirmar que no se rompió nada.
3. **Clientes de prueba temporales** (como "PRUEBA OP047 ABONOS") y un operador temporal. Se crean al empezar cada prueba y se borran al terminar, comprobando que no queden restos.
4. Cada cambio de base de datos lleva su **migración** (como una actualización del manual de instrucciones de la base) y su **reversa** (para deshacerla si hace falta).
5. Cada fase actualiza el **registro de fallas** (estado 🟡) y este plan. Al final se crea el documento de resultados.

## Fase 0 — Preparación (antes de tocar código)

| Paso | Qué | Por qué |
|---|---|---|
| 0.1 | **Comparar el código de staging con el de producción** archivo por archivo y traer a staging lo que producción tenga más nuevo (por ejemplo `Toast.jsx`, falla **N11**) | Staging tiene archivos más viejos. Si no se igualan, se arregla sobre una base distinta a la real |
| 0.2 | **Volver a copiar a staging** la cartera de producción: todos los clientes con movimientos, no solo los 41 de OP-040 | Para que el reporte final cubra a todos los clientes |
| 0.3 | Guardar una **foto "antes"** de cada cliente: deuda, saldo a favor, pagado de más y movimientos | Es la columna "Hoy" del reporte final |
| 0.4 | Correr las pruebas actuales (380 automáticas, build) y dejar constancia | Punto de partida conocido |
| 0.5 | Crear la **fábrica de escenarios**: un solo script que arma clientes de prueba (crédito, cobro a destino, donación, abono suelto, abono enlazado, devolución) y los borra | Todas las fases la usan |

**Prueba de salida:** staging igual a producción en los archivos de CxC, despachos y mensajes; foto "antes" guardada; 380/380 en verde.

## Fase 1 — Registrar abonos sin perderlos ni duplicarlos

| Falla | Arreglo | Prueba que lo confirma |
|---|---|---|
| **N10** — si el abono falla, no hay aviso | Mostrar un mensaje rojo claro ("No se guardó el abono: …") en abonar, cargar saldo a favor y devolver saldo. Dejar el monto escrito y marcar el formulario como "no guardado". Anotar el fallo en el registro de errores | Navegador real: forzar sesión vencida, error del servidor y sin internet → aparece el mensaje rojo y no se guarda nada |
| **G4** — doble clic guarda 2 | La ficha manda una **clave única de operación** por intento. El botón se bloquea mientras guarda. El servidor avisa si hay un abono igual (mismo cliente, monto y referencia) en los últimos minutos y pide confirmar | Doble clic real y dos peticiones iguales a la vez → 1 solo abono. Abono igual 2 minutos después → pide confirmación |
| **I2** — dos operadores a la vez pagan de más | Registrar el abono en **una sola operación dentro de la base**, que bloquea al cliente mientras valida y guarda. Lo mismo para cruzar saldo a favor | Dos abonos simultáneos por el saldo completo → se acepta 1, el otro recibe "la deuda cambió" |
| **N8** — el detalle no se compara con el monto | El servidor exige que la suma del detalle de formas de pago sea igual al monto (tolerancia de 1 centavo) | Abono de $40 con detalle de $10 → rechazado con mensaje claro |
| **N9** — monto en texto da error técnico | Validar que el monto sea un número mayor que 0 con máximo 2 decimales | "abc", vacío y "1e9" → mensaje claro, sin error técnico |

## Fase 2 — Anular, reabrir y editar despachos sin perder pagos

| Falla | Arreglo | Prueba que lo confirma |
|---|---|---|
| **G2** — reabrir o anular deja pagos huérfanos o los borra | Antes de reabrir o anular, calcular con el **reparto unificado** (el de OP-042) qué abonos, **enlazados o sueltos**, cubren ese despacho. Si hay, pedir qué hacer: pasarlos a saldo a favor o bloquear. **Quitar el camino viejo** que borra todo lo enlazado sin protección | Despacho pagado con abono suelto → reabrir pide decisión y no deja pagado de más escondido. Camino viejo → ya no existe |
| **N1** — anular un despacho con pago anotado (Zelle, USDT…) lo hace desaparecer | Si el despacho tiene pagos anotados que no son crédito, al anular se pregunta: pasar a saldo a favor, mover al despacho nuevo, o confirmar "no se cobró" (con motivo obligatorio, que queda en la auditoría) | Caso Angel Pineda reproducido (#4775 Zelle → anulado → #4841 a crédito) → el Zelle queda como saldo a favor o aplicado al #4841 |
| Edición profunda (parte de **G2**) | La edición profunda no borra créditos de devolución ni consumos de saldo a favor que no le pertenecen. Si cambia la forma de pago y el despacho tenía abonos, avisa | Editar un despacho con devolución previa → el crédito de la devolución sigue |
| **M6** — "auto-sanación" que inventa cargos | Quitarla. Si un pago enlazado no encuentra deuda, se rechaza con mensaje | Abono enlazado a un despacho sin cargo → rechazado, no se crea deuda |

## Fase 3 — Devoluciones correctas

| Falla | Arreglo | Prueba que lo confirma |
|---|---|---|
| **N2** — devolver lo donado da crédito | Si el despacho (o la parte devuelta) fue **Donación**, la devolución mueve inventario pero **no da crédito ni reembolso**. Si se quiere dar crédito, exige autorización explícita y motivo | Casos Los Guayos #4211 y #4800 reproducidos → $0 de crédito; con autorización → crédito y queda en la auditoría |
| **N6** — la auditoría de devoluciones nunca se guarda | Encontrar por qué falla el registro `DEVOLUCION_PARCIAL` y corregirlo | Cada devolución de prueba deja su registro en la auditoría |
| **G1** (ya en staging) | Volver a probar con todo lo nuevo | Caso Encendo → debe $195, a favor $4,30 |

## Fase 4 — Que nada se borre sin rastro

| Falla | Arreglo | Prueba que lo confirma |
|---|---|---|
| **I3** — revertir borra el abono | "Revertir" pasa a **anular con marca**: el abono queda guardado como anulado (con quién, cuándo y motivo obligatorio) y deja de contar en la deuda. No se permite revertir abonos que vienen de una devolución | Revertir → el abono sigue visible como "anulado", la deuda sube, la auditoría tiene la copia completa. Revertir un abono de devolución → bloqueado |
| **N5** — cobros a destino e intercambios sin auditoría | Conciliar cobro a destino y cobrar diferencia de intercambio escriben en la auditoría como cualquier abono | Conciliar un cobro a destino de prueba → aparece en la auditoría |
| **N7** (ya resuelta) | Comprobar que todo abono nuevo queda en la auditoría | Incluida en las pruebas de las fases 1 y 4 |
| **N3** — Cruce sin decir contra qué | Extender a la **forma de pago del despacho** la regla que ya existe en los abonos: el Cruce exige escribir contra qué se cruzó | Despacho con "Cruce" sin explicación → no deja guardar |

## Fase 5 — Lo que ya está en staging (repaso)

| Falla | Qué se hace |
|---|---|
| **G1, G3, I1, M2** | Ya arreglados en OP-042. Se vuelven a probar junto con todo lo nuevo (pagado de más visible, selector de despacho, historial completo) |
| **N4** | El código ya no repite el error. Se prepara en staging el script que corrige los **13 registros viejos** (de "abono" a "consumo de saldo a favor"), solo para simular. Corregirlos en producción necesita aprobación |
| **N11** | Se resuelve en la fase 0 al igualar `Toast.jsx` con producción |

## Fase 6 — Acceso, consistencia y detalles

| Falla | Arreglo | Prueba que lo confirma |
|---|---|---|
| **I4** — un vendedor puede leer toda la cartera | Ajustar la regla de lectura de la base: cada vendedor ve solo a sus clientes; administración, jefe y desarrollador ven todo | Consulta directa con la sesión de un vendedor de prueba → solo sus clientes. Recorrer todas las pantallas con cada rol |
| **M1** — saldo "foto" desactualizado en el historial | Calcular el saldo de cada línea al mostrarla | Revertir un abono viejo → todas las líneas siguientes muestran el saldo correcto |
| **M3** — despachos con dos deudas | Que un abono enlazado pague primero la parte correcta (crédito o cobro a destino) | Los 7 despachos reales con dos deudas, copiados → vencimientos correctos |
| **M4** — el mismo cálculo copiado en varios sitios | Pantalla, reporte, aviso diario y servidor usan **una sola función** de reparto y de saldo | Prueba de comparación: mismas cifras en ficha, reporte, PDF y aviso para todos los clientes copiados |
| **M5** — errores de recálculo que nadie ve | Si falla el recálculo, se anota en el registro de errores y se avisa | Forzar un fallo de recálculo → aparece en el registro |
| **M7** — lecturas sin paginar | Leer por páginas en el reporte de cartera | Escenario con más de 1.000 movimientos → el reporte los muestra todos |

## Fase 7 — Prueba final completa y reporte de clientes

1. **Todas las pruebas juntas:**
   - pruebas automáticas (las 380 actuales más las nuevas de cada fase),
   - build,
   - pruebas contra el servidor (`op047-abonos-api.mjs` ampliado con todos los casos),
   - navegador real con cada rol (administración, jefe, vendedor).
   - **Meta:** todo en verde.
2. **Repetir los casos reales** con los datos copiados: Encendo, Los Guayos, Angel Pineda #4775/#4841, Carlos Escalona, REYKAR, Yhoel Sanchez, Solidere/REYKAR $78.
3. **Reporte de clientes:** un script compara, para cada cliente con movimientos:
   - **Hoy** (foto de la fase 0),
   - **Con el código arreglado** (lo que verá la pantalla: deuda, saldo a favor y pagado de más visible),
   - **Con correcciones aprobadas** (simuladas dentro de una operación que se deshace sola, como en OP-041).
4. **Documento de resultados** (nuevo caso OP), registro de fallas con estado 🟡 y README de staging actualizado.
5. **Limpieza:** borrar clientes y operadores temporales y confirmar que no quedan restos.

## Proyección preliminar: cómo quedarían los clientes

> Basada en las revisiones OP-2026-039 a OP-2026-047. El reporte de la fase 7 la confirmará con todos los clientes.
> **"Código arreglado"** = lo que cambia solo por el arreglo. **"Con corrección aprobada"** = si administración confirma el caso.

| Cliente | Hoy | Con el código arreglado | Con corrección aprobada | Decide |
|---|---|---|---|---|
| **Decoraciones Encendo** | Debe $0; $1.949 escondidos | Se ve "pagado de más $1.949" | Debe **$195**, a favor $4,30 | Administración (anular el Cruce "NO PROCEDE") |
| **11 clientes con pagos viejos de saldo a favor** (Ferrechuros $810, Jonny Espinoza $66,25, etc.) | Sobrantes escondidos ($1.014,03 en total) | Se ven como "pagado de más" | Sobrante $0; **ningún saldo cambia** (El Gran Adonay pasa a deber $0,34) | Aprobación para corregir los 13 registros (N4) |
| **Carlos Escalona** | $356 escondidos | Se ven | Escondido $0 (abono duplicado anulado) | Caja |
| **Adalberto Rojas / A_40** | $1.051 / $600 escondidos | Se ven | Según el origen que confirme caja | Caja |
| **Beatriz Landadeta** | 2 abonos de prueba de $0,01 | Se ven | Se anulan | Administración |
| **Angel Pineda** | Debe $4.002,10 | Igual (y ya no podrá repetirse) | Debe **$449,60** si llegó el Zelle de $3.557,50 | Caja |
| **Juan Carlos Medrano** | Debe $5.851,75 | Igual | Entre $1.715,69 y $8.851,75, según caja (USDT del #3401 y posible doble conteo de $3.000) | Caja |
| **REYKAR** | Debe $748,46 | Igual | Hasta $1.748,46 si uno de los dos $1.000 es repetido; ±$78 por el Zelle compartido | Caja |
| **Solidere** | Debe $34.188 | Igual | $34.266 si el Zelle de $78 era de REYKAR | Caja |
| **Richard Mora** | Debe $12.054,72 | Igual | $12.193,72 si el Cruce de $139 se repitió | Caja |
| **Yhoel Sanchez** | (2 × $500 en 7 segundos) | Igual | Sube $500 si fue un solo pago | Caja |
| **Construacero Los Guayos** | Debe $1.345,50; a favor $450 | Igual (lo nuevo ya no da crédito por lo donado) | Debe **$1.700,50**, a favor $0 | Administración (regla de donaciones) |
| **Yahveh / KIA 241 / Albert Ruiz / Constructora Ew** | Deben $313,43 / $64,50 / $60,59 / $850 | Igual | $0 cada uno, **si caja confirma** los pagos y se registran | Caja (comprobantes) |
| **TecnoHierro** | Debe $434,40 | Igual | $54,40 si aparece el comprobante de $380 | Caja |
| **Resto de clientes** | — | **Sin cambios** en deuda ni saldo a favor | — | — |

**Total de dinero escondido (pagos de más):** hoy $4.969,71 sin verse. Con el código arreglado **se ve todo**. Con las correcciones de OP-041 aprobadas baja a unos **$1.651,02**, que dependen de lo que confirme caja.

## Riesgos y cómo se controlan

| Riesgo | Control |
|---|---|
| Cambiar la regla de lectura (I4) puede dejar pantallas sin datos | Probar cada pantalla con cada rol antes de cerrar la fase 6 |
| Pasar el registro de abonos a una sola operación en la base (I2) cambia una pieza central | Probar todos los casos de la fase 1 contra el servidor y en navegador. La migración tiene reversa |
| Igualar staging con producción (fase 0) puede pisar arreglos que solo están en staging (OP-042) | Comparar archivo por archivo y unir los cambios a mano, no copiar a ciegas |
| Datos reales de clientes en staging | Las capturas y datos crudos quedan en carpetas que no se suben a GitHub (`tmp/`, `.tmp-op040/`) |

## Qué necesito de ti para empezar

- **Aprobación de este plan** para ejecutarlo en staging, fase por fase.
- En paralelo, y sin bloquear el código, que **administración y caja respondan** las preguntas de OP-041, OP-043, OP-044, OP-046 y OP-047. Sus respuestas llenan la columna "Con corrección aprobada" del reporte final.
