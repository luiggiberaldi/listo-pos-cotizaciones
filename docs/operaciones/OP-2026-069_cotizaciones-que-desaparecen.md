# OP-2026-069 — Cotizaciones que "desaparecen" (auditoría y arreglo)

**Fecha:** 2026-11-24 · **Estado:** **publicado en producción el 2026-11-24** (solicitud #72, commit `2f847c2e`) · Rama `fix/op-067-cotizaciones-que-desaparecen` · Plan: [OP-2026-069_plan-cotizaciones-que-desaparecen.md](../plans/OP-2026-069_plan-cotizaciones-que-desaparecen.md)

> Nota de numeración: este caso se trabajó primero con el número OP-2026-062, que ya estaba usado por otro caso (reporte de Crédito). Se renumeró (primero a 065 y luego a 067, ambos ocupados por otras conversaciones) a **OP-2026-069**, y sus fallas pasaron a **N36–N40**.

## En resumen

- **Las cotizaciones creadas el mismo día no las borra la base de datos.** Revisé producción: las cotizaciones de los últimos 7 días tienen sus números completos, sin huecos (hoy de la 4905 a la 4938: las 34 están).
- **Lo más probable es que nunca llegaron a guardarse.** Si guardar tarda más de 8 segundos o el servidor da un error, la pantalla guarda la cotización **solo en el teléfono o la computadora del vendedor**, le muestra "enviada" con número **OFFLINE** y borra el borrador. Después intenta subirla sola, pero **ese reenvío siempre falla** porque no manda la identificación del vendedor (el PIN). La cotización queda atrapada en ese equipo y nunca aparece en el sistema.
- **No queda ningún rastro.** La acción "crear cotización" no se ha guardado nunca en la auditoría (0 registros en 14 días), por un error separado.
- **Aparte**, la limpieza nocturna sí **borra** de verdad las cotizaciones no aceptadas con más de 30 días (entre 5 y 18 por noche esta semana). Eso explica las que desaparecen tiempo después, no las del mismo día.
- **Arreglo (hecho en staging, ver "Qué se cambió"):** las cotizaciones atrapadas se suben solas cuando su vendedor entra con el PIN. La pantalla ya no dice "enviada" si no lo está. Los reintentos no duplican. Crear y editar quedan en la auditoría. Editar ya no puede dejar una cotización sin productos. La limpieza ya no borra al mes: vence a los 30 días sin movimiento y borra al año, con copia (opción B, elegida por el dueño).

## 1. Cotizaciones del mismo día: atrapadas en el equipo del vendedor (causa probable)

Es como mandar una carta: si el correo tarda, la pantalla mete la carta en una gaveta y dice "enviada". Después intenta mandarla de nuevo, pero sin la firma del vendedor, así que el correo la rechaza. La carta se queda en la gaveta para siempre.

Paso a paso:

1. El vendedor pulsa **Enviar**. La pantalla intenta guardar en el servidor y espera **8 segundos como máximo** ([useCotizaciones.js:351](../../src/hooks/useCotizaciones.js)).
2. Si tarda más (señal móvil lenta, servidor ocupado) o el servidor responde con error, la pantalla **guarda la cotización solo en el navegador** con un número temporal `local_…` ([useCotizaciones.js:370-385](../../src/hooks/useCotizaciones.js)). Esto pasa **aunque haya internet**.
3. La pantalla **da la cotización por "enviada"**, muestra el número **OFFLINE** y borra el borrador ([CotizacionBuilder.jsx:958-964](../../src/components/cotizaciones/CotizacionBuilder.jsx)). El vendedor cree que quedó lista.
4. La lista de cotizaciones se recarga desde el servidor, donde esa cotización **no existe**. Para el vendedor, "desapareció".
5. El reenvío automático ([useMutationQueue.js:24-58](../../src/hooks/useMutationQueue.js) y [sw.js:82](../../src/sw.js)) manda la cotización **sin la sesión del vendedor** (sin el PIN). El servidor exige esa sesión ([cotizaciones.js:65](../../api/handlers/cotizaciones.js)) y responde "No hay operador seleccionado". **Ningún reenvío puede funcionar nunca.** Tras varios intentos queda marcada como fallida, y si el vendedor pulsa "descartar" se pierde para siempre.

Lo que dicen los datos de producción:
- **No hay ni un solo borrador** creado en los últimos 3 días (26 enviadas y 34 aceptadas). Cuadra con que nada de lo que llega se queda a medias.
- Leer cotizaciones llega a tardar **7,7 segundos** en los momentos peores, muy cerca del límite de 8. Con datos móviles, guardar puede pasarse.
- **No puedo contar cuántas quedaron atrapadas.** Viven en el navegador de cada vendedor, no en el servidor.

**Cómo comprobarlo con un vendedor afectado:** pregúntale si al enviar vio el número **"OFFLINE"** o el aviso **"Sin conexión — cotización guardada localmente"**, o si tiene un aviso de **ventas pendientes o fallidas** en pantalla. Si tiene alguno, la cotización está guardada solo en su equipo. **Que no pulse "descartar"**: se puede recuperar.

## 2. "Crear cotización" nunca queda en la auditoría

En [cotizaciones.js:174](../../api/handlers/cotizaciones.js) el servidor responde al vendedor **antes** de terminar de escribir la auditoría. La nube (Cloudflare) corta el trabajo pendiente en cuanto se envía la respuesta, así que la anotación nunca se guarda. En producción hay **0 registros de CREAR_COTIZACION** en 14 días, frente a 244 de ENVIAR_COTIZACION. Por eso no se puede reconstruir quién creó qué ni cuándo.

## 3. La limpieza nocturna borra a los 30 días (confirmado)

Todos los días a las 11:00 p. m. (hora de Venezuela) corre `runCleanupCotizaciones` ([cotizaciones.js:853](../../api/handlers/cotizaciones.js)):

| Edad (desde que se creó) | Estado | Qué hace |
|---|---|---|
| más de 15 días | borrador o enviada | la pasa a **anulada** |
| más de 30 días | borrador, enviada, rechazada, anulada o vencida | la **borra definitivamente**, con sus productos |

Borradas en producción: 18 (20-nov), 14 (21-nov), 5 (22-nov) y 10 (23-nov). En la numeración se ven los huecos que deja (3846, 3858–3860, …).

Problemas:
- Cuenta desde la **creación**, no desde la última modificación.
- No avisa a nadie.
- Solo guarda la cantidad borrada. No se sabe qué cotización, cliente ni monto se perdió.
- Corre **dos veces por noche** (con unos 4 segundos de diferencia). La segunda no encuentra nada, pero no debería pasar. Falta averiguar por qué.
- La misma lógica está en staging.

Las cotizaciones **aceptadas** (las que ya son despacho) **no** se borran.

## 4. Riesgo extra: editar una cotización puede dejarla vacía

Al editar un borrador, el servidor **borra los productos viejos al mismo tiempo** que actualiza la cabecera, y después inserta los nuevos ([cotizaciones.js:144-170](../../api/handlers/cotizaciones.js)). Si la cabecera o la inserción fallan, los productos viejos ya se perdieron y la cotización queda sin productos. No se vio en producción (no hay borradores recientes), pero el riesgo existe.

## Qué se propuso arreglar (en este orden)

Plan detallado: [OP-2026-069_plan-cotizaciones-que-desaparecen.md](../plans/OP-2026-069_plan-cotizaciones-que-desaparecen.md).

1. **Reenvío con la sesión del vendedor** (urgente): que las cotizaciones atrapadas se suban solas apenas el vendedor abra la app con su PIN. Así se recuperan las que ya están atrapadas.
2. **No fingir que se envió:** si el servidor tarda o falla estando con internet, decir claramente "no se pudo guardar, reintenta" en vez de guardarla en la gaveta. Subir el tiempo de espera de 8 a unos 20 segundos.
3. **Auditoría de "crear cotización"** que sí se guarde.
4. **Limpieza nocturna:** el dueño eligió el 2026-11-24 la **opción B**: vencer a los 30 días sin movimiento y borrar las vencidas al año, con copia completa en la auditoría.
5. **Editar sin perder productos:** hacer el cambio en un solo paso.

Todo se probaría primero en staging y después se publicaría en producción.

## Qué se cambió (en la rama, igual en producción y en staging)

| Arreglo | Dónde | Qué hace ahora |
|---|---|---|
| 1. Reenvío con PIN (N36) | [useMutationQueue.js](../../src/hooks/useMutationQueue.js), [mutationQueue.js](../../src/lib/mutationQueue.js), [sw.js](../../src/sw.js) | El reenvío lleva la sesión del vendedor. Solo sube una cotización cuando entra con su PIN **el mismo vendedor que la hizo**, así no queda a nombre de otro en un equipo compartido. Se intenta al abrir la app, al entrar con el PIN y al volver la conexión. Esperar el PIN no gasta intentos. El reenvío en segundo plano del navegador ya no toca cotizaciones, porque no puede leer el PIN |
| 1. Sin duplicados (N36) | [cotizaciones.js](../../api/handlers/cotizaciones.js), [CotizacionBuilder.jsx](../../src/components/cotizaciones/CotizacionBuilder.jsx) | Cada cotización nueva lleva su identidad desde el primer intento, guardada también en el borrador automático. Si un intento ya llegó, el servidor lo reconoce: si sigue en borrador lo actualiza, y si ya fue enviada no hace nada. Nunca crea otra |
| 2. No fingir el envío (N36) | [useCotizaciones.js](../../src/hooks/useCotizaciones.js), [CotizacionBuilder.jsx](../../src/components/cotizaciones/CotizacionBuilder.jsx), [PendingQueueBadge.jsx](../../src/components/ui/PendingQueueBadge.jsx) | Espera hasta 20 segundos (antes 8). Con internet, si falla, avisa "No se pudo guardar… pulsa de nuevo" y la cotización sigue en pantalla. Solo sin internet queda **PENDIENTE** en el equipo, con un aviso claro de que no está en el sistema. El aviso de pendientes dice "Cotización pendiente" y pide confirmación antes de descartar |
| 3. Auditoría (N37) | [cotizaciones.js](../../api/handlers/cotizaciones.js), [worker.js](../../worker.js) | La nube termina de escribir CREAR_COTIZACION y EDITAR_COTIZACION aunque ya haya respondido |
| 4. Limpieza nocturna, opción B (N38) | [limpiezaCotizaciones.js](../../api/lib/limpiezaCotizaciones.js) | Enviada sin movimiento en 30 días → vencida. Borrador sin movimiento en 30 días → anulada (la base no permite borrador → vencida). Cada una queda en la auditoría. Vencida, rechazada o anulada sin movimiento en 1 año → copia completa en la auditoría y luego se borra; sin copia no se borra. Las que tienen despacho o comisiones no se borran. Las aceptadas nunca se tocan. Un candado evita que corra dos veces por noche |
| 5. Editar sin perder productos (N39) | [cotizaciones.js](../../api/handlers/cotizaciones.js) | Primero inserta los productos nuevos y después borra solo los viejos. Si algo falla, la cotización queda como estaba |

No hubo cambios en la estructura de la base de datos.

**Efecto la primera noche en producción:** hoy hay **0** cotizaciones que vencerían y **0** que se borrarían (consulta de solo lectura del 2026-11-24). Lo único que cambia es que ya no se borra nada al mes.

## Pruebas

- **Pruebas automáticas nuevas (25):** limpieza nocturna (candado, 30 días desde la última modificación, copia antes de borrar, no borrar sin copia, saltar las que tienen vínculos), guardado (identidad propia, reintento sin duplicar, id de otro vendedor rechazado, edición segura y su deshacer, auditoría) y cola (esperar el PIN no gasta intentos).
- **Producción (código):** 1.228 de 1.228 pruebas pasan. Un archivo de pruebas, `medirRendimientoServerTiming`, no corre en la copia aparte porque necesita el archivo de credenciales `.env`. No tiene relación con este cambio.
- **Staging (código):** 278 de 278 pruebas pasan, incluidas las nuevas.
- **La app se construye sin errores** en las dos versiones. Revisión de estilo: ningún error nuevo (los 8 del armador de cotizaciones ya existían).
- **Contra la base real de staging** ([prueba.staging.test.js](OP-2026-069_scripts/prueba.staging.test.js), 4 de 4):
  - crear con identidad propia y reintentar deja **una sola** cotización con un producto;
  - editar deja exactamente los 2 productos nuevos;
  - quedan guardados **CREAR_COTIZACION** y **EDITAR_COTIZACION** en la auditoría;
  - la limpieza, lanzada dos veces a la vez, trabajó **una sola vez**: pasó **146 enviadas a vencida** y **16 borradores a anulada**, con 162 anotaciones en la auditoría, y **no borró ninguna**. Staging acumulaba cotizaciones viejas porque su limpieza no corría desde agosto. La cotización de prueba se borró al terminar.

### Segunda revisión (pedida por el dueño: "que realmente no se borren")

- **Rescate de las ya atrapadas (agregado):** las cotizaciones que, antes del arreglo, agotaron sus 3 intentos por el defecto del PIN quedaron como "fallidas" y no se habrían subido solas. Ahora, al abrir la app, vuelven solas a la fila de pendientes. Solo las de ese error: las que fallaron por otro motivo siguen visibles para el vendedor. Tiene su prueba automática. Pruebas después de este agregado: **1.229 de 1.229** en producción (incluido `medirRendimientoServerTiming`, que pasó al darle sus credenciales, 3 de 3) y **279 de 279** en staging.
- **Búsqueda de todo lo que puede borrar cotizaciones:**
  - **Dentro de la base de producción:** ninguna función interna ni disparador borra cotizaciones, y no hay tareas programadas en la base (sin `pg_cron`).
  - **En el código, con el cambio:** la única parte que borra cotizaciones de forma automática es la limpieza nueva: al año, con copia previa, y nunca las aceptadas.
  - **Herramientas de administración (sin cambios):** "Reset operacional" y las del Tester ("clear all", "seed demo", "stress seed") borran **todas** las cotizaciones de la cuenta. Las puede usar un jefe, administración o el desarrollador. **No hay ningún rastro de que se hayan usado en producción** (ni en la auditoría ni en los registros del sistema). Quedan anotadas como riesgo (N41).
- **Producción, cifras reales (solo lectura, 2026-11-24):**
  - **Últimos 30 días:** 661 cotizaciones creadas, **ninguna falta**.
  - **Toda la historia:** de la 206 a la 4938 existen 3.052 y faltan 1.681 números. Desde el 26 de julio, la limpieza vieja borró **1.026** en 97 noches (según sus registros). El resto es anterior a esos registros.
- **Prueba en pantalla:** primer intento sin acceso (la cuenta de pruebas tenía otra contraseña). Ver la sección siguiente.

### Prueba en pantalla (staging local, 2026-11-24, con permiso del dueño)

Con permiso del dueño se regeneró la cuenta de pruebas de staging (`provision:e2e:staging`) y se le puso al "Vendedor E2E Staging" el PIN de prueba del proyecto, igual que hace el programa de pruebas. Después se usó la app de verdad en el navegador, con el código nuevo y la base de staging. Cada cotización se comprobó en la base:

| Prueba | Qué se hizo | Resultado en pantalla | Resultado en la base |
|---|---|---|---|
| A. Con conexión | Crear y enviar | "Cotización enviada", COT-04897 | 1 cotización, enviada, 1 producto; auditoría **CREAR_COTIZACION** y ENVIAR_COTIZACION |
| B. Sin conexión con la pantalla abierta (antes del ajuste) | Cortar la red, enviar y devolver la red | El botón se quedó "pensando" hasta que volvió la red; después "enviada", COT-04907 | 1 cotización, enviada. No se pierde, pero no avisaba nada (ver ajuste 1) |
| C. Sin conexión (con el ajuste) | Cortar la red y enviar | "**Cotización pendiente — guardada solo en este equipo**", con aviso de no descartarla y sin botón Despachar | Guardada en el equipo con su identidad y su vendedor. Al volver la red **se subió sola, una vez**: COT-04915, como borrador |
| D. Servidor lento (el caso original) | El servidor sí la guarda, pero la pantalla no recibe la respuesta | "**No se pudo guardar… Tu cotización sigue aquí; pulsa de nuevo**" (antes: "enviada" falsa). Al pulsar otra vez: "enviada", COT-04923 | **Una sola** cotización: los dos intentos llevaron la misma identidad. Enviada, 1 producto |
| Lista | Abrir la lista de cotizaciones | Aparecen todas las de prueba | Ninguna se perdió |

**Ajustes hechos por lo que mostró la prueba** (en producción y staging):
1. **Sin conexión ya no se queda "pensando":** la herramienta de la pantalla pausaba el guardado en silencio mientras no había red. Esto ya pasaba antes del cambio y no perdía nada, pero tampoco avisaba. Ahora va directo a "PENDIENTE", con aviso, y la copia queda guardada en el equipo aunque se cierre la pantalla.
2. **Avisos honestos:** la cotización pendiente se sube **como borrador**, porque enviarla al cliente necesita la tasa del día. Los avisos ahora lo dicen: "se subirá como borrador; después ábrela y pulsa Enviar". El título de arriba dice "Cotización pendiente".
3. **Sin botón Despachar** en una cotización pendiente, porque todavía no existe en el sistema.
4. **Auditoría del reintento:** cuando el reintento actualiza un borrador que ya había llegado, se anota EDITAR_COTIZACION, no un segundo "crear". En la prueba D, hecha antes de este ajuste, quedaron dos CREAR_COTIZACION.
5. Fijar el vehículo habitual del chofer se omite sin conexión, para no frenar el envío.

**Pruebas después de los ajustes:** **1.232 de 1.232** en producción (los 123 archivos, ninguno saltado) y **279 de 279** en staging. La app se construye en las dos versiones. Revisión de estilo sin errores nuevos.

Las 4 cotizaciones de prueba quedaron en staging con la nota interna "PRUEBA OP-069".

## Fallas relacionadas encontradas (no arregladas en este cambio)

- **N41 — Herramientas que borran todo:** "Reset operacional" y las del Tester borran todas las cotizaciones de la cuenta, y en producción las puede usar un jefe o administración. Sin rastro de uso. Conviene bloquear las del Tester en producción y pedir una doble confirmación para el reset. Necesita su propio caso.
- **N40 — Ventas rápidas sin conexión:** tienen el mismo defecto de reenvío (sin PIN, siempre falla). **No se arregló aquí a propósito**: el servidor de ventas rápidas no tiene protección contra duplicados, y activar el reenvío podría crear **ventas dobles**, con su efecto en dinero e inventario. Necesita su propio caso: primero la protección contra duplicados y después el reenvío.

## Cómo se verificó

- Consultas de **solo lectura** a la base de producción (`oyfyuszgjwcepjpngclv`) con la llave de acceso del archivo `.env`, autorizado por el usuario. Las consultas se guardaron en la carpeta local `tmp/op062/` del equipo, fuera del repositorio.
- Revisión del código de la pantalla, del servidor y de la tarea nocturna.

## Pendiente o sin verificar

- No se pudo contar cuántas cotizaciones están atrapadas en los equipos. Hay que preguntar a los vendedores afectados.
- No se pudo medir cuánto tarda guardar una cotización: el registro de tiempos solo mide lecturas.
- Falta saber por qué la limpieza corre dos veces por noche.
- **Falta publicar en producción**: necesita tu visto bueno. Al publicar se anotará aquí el número de la solicitud de cambio y el commit.
- **Prueba en pantalla: hecha** (ver tabla). La red se cortó **simulándolo dentro del navegador**, no desconectando el equipo de verdad. Lo único sin probar en pantalla es el caso "otro vendedor entra en el mismo equipo" (cubierto por prueba automática). Después de publicar conviene repetir la prueba C en un teléfono real, con datos apagados.
- Una cotización pendiente llega al sistema **como borrador**: el vendedor debe abrirla y pulsar Enviar. Los avisos lo dicen.
- **Descartar una pendiente** no deja copia en la auditoría: sin conexión no se puede escribir en el servidor. Se puso una confirmación clara.
- **Las cotizaciones atrapadas desde antes del arreglo** no tienen identidad propia. Si alguna sí había llegado al servidor, podría subirse dos veces (riesgo bajo: en producción no hay borradores recientes).
- **N40** (ventas rápidas sin conexión) queda abierta.

## Publicación (2026-11-24)

Solicitud #72 unida a main (commit `2f847c2e`); servidor desplegado con éxito y Vercel "Ready". Ruta de guardar sin sesión responde 401. **Sin verificar aún:** prueba "sin conexión" en un teléfono real y la primera limpieza nocturna en producción.
