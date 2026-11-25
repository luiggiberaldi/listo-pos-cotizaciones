# Plan OP-2026-067 — Que ninguna cotización se pierda

**Fecha:** 2026-11-24 · **Estado:** aprobado por el dueño y **hecho en staging** (2026-11-24); falta publicar en producción. Resultado en el [caso OP-2026-067](../operaciones/OP-2026-067_cotizaciones-que-desaparecen.md)
**Caso:** [OP-2026-067](../operaciones/OP-2026-067_cotizaciones-que-desaparecen.md) · **Fallas:** N28, N29, N30, N31 del [registro de fallas](../operaciones/REGISTRO-FALLAS-CODIGO.md)

## En resumen

- Son **5 arreglos**. Primero se prueban en **staging** (la copia de pruebas) y después se pasan a **producción** en una sola publicación.
- Lo más urgente: que las cotizaciones atrapadas en los equipos de los vendedores **se suban solas** y que la pantalla **no diga "enviada" cuando no lo está**.
- Limpieza nocturna: **decidido por el dueño el 2026-11-24, opción B**. Las cotizaciones sin movimiento en 30 días pasan a **"vencida"**, y las vencidas se borran **después de 1 año**, guardando antes una copia en la auditoría.
- No hace falta cambiar la estructura de la base de datos. Son cambios en la pantalla y en el servidor.
- Tiempo estimado: un día de trabajo más las pruebas en staging.

## Arreglo 1 — Las cotizaciones atrapadas se suben solas (N28, urgente)

**Problema:** el reenvío automático manda la cotización sin el PIN del vendedor y el servidor la rechaza siempre.

**Qué se hará:**
1. Que el reenvío desde la pantalla ([useMutationQueue.js](../../src/hooks/useMutationQueue.js)) lleve la sesión del vendedor, igual que un guardado normal (`getAuthHeaders`).
2. Que solo reenvíe cuando hay un vendedor con PIN activo. Si no lo hay, espera sin gastar intentos.
3. Que también intente al abrir la app y al ingresar el PIN, no solo al recuperar la conexión. Las que ya están atrapadas se subirán la próxima vez que el vendedor entre.
4. El reenvío en segundo plano del navegador ([sw.js](../../src/sw.js)) no puede leer el PIN. Para cotizaciones se desactiva y lo hace solo la pantalla.
5. Las fallidas **no se pierden**: "descartar" pide confirmación y deja copia en la auditoría.
6. **Que no se dupliquen:** la pantalla le pone a cada cotización nueva su número de identidad propio desde el primer intento. Si el servidor ya la había guardado (por ejemplo, cuando tardó pero sí llegó), el reenvío la reconoce y no crea otra igual.

**Cómo se sabe que funciona:** prueba automática de que el reenvío lleva el PIN. En staging: cortar la conexión a mitad de un guardado, volver a entrar y comprobar que la cotización aparece **una sola vez**.

## Arreglo 2 — No fingir que se envió (N28)

**Problema:** con internet, si el servidor tarda más de 8 segundos o da error, la pantalla guarda la cotización a escondidas y dice "enviada" con número OFFLINE.

**Qué se hará** ([useCotizaciones.js](../../src/hooks/useCotizaciones.js), [CotizacionBuilder.jsx](../../src/components/cotizaciones/CotizacionBuilder.jsx)):
1. Subir el tiempo de espera de **8 a 20 segundos**.
2. **Con internet:** si falla, mostrar "No se pudo guardar, intenta de nuevo" y **conservar el borrador** en pantalla. No se da por enviada.
3. **Sin internet de verdad:** se guarda en el equipo, pero con un aviso claro y permanente: "Pendiente de subir — no está en el sistema todavía". Nunca "enviada".
4. El número "OFFLINE" se reemplaza por "PENDIENTE".

## Arreglo 3 — "Crear cotización" queda en la auditoría (N29)

**Problema:** el servidor responde antes de escribir la auditoría y la nube corta la tarea.

**Qué se hará:** en [cotizaciones.js:174](../../api/handlers/cotizaciones.js), pedirle a la nube que termine de escribir la auditoría aunque ya se haya respondido. El sistema ya tiene esa herramienta (`env.waitUntil`, en [worker.js:58](../../worker.js)). Revisar si otras acciones tienen el mismo defecto y arreglarlas igual.

**Cómo se sabe que funciona:** en staging, crear una cotización y ver el registro CREAR_COTIZACION en la auditoría.

## Arreglo 4 — Limpieza nocturna sin borrar (N30)

**Decisión del dueño (2026-11-24): opción B.**

**Qué se hará** ([cotizaciones.js:853](../../api/handlers/cotizaciones.js), y lo mismo en staging):
1. Cada noche, las cotizaciones en borrador o enviadas **sin movimiento en 30 días** (según la última modificación) pasan a **"vencida"**. Cada una queda en la auditoría con su número, cliente, vendedor y monto.
2. Las cotizaciones vencidas, rechazadas o anuladas **sin movimiento en 1 año** se borran. **Antes de borrar**, se guarda en la auditoría una copia completa de cada una, con cabecera y productos. Si la copia no se puede guardar, esa cotización **no se borra**.
3. Las **aceptadas** nunca se tocan.
4. Si la limpieza ya corrió en la última hora, la segunda vez no hace nada. Así corre una sola vez por noche.
5. El resumen nocturno sigue guardándose en los registros del sistema.

**Efecto el primer día:** las anuladas de entre 30 días y 1 año ya no se borran. Las enviadas viejas sin movimiento pasan a vencida.

## Arreglo 5 — Editar sin perder productos (N31)

**Problema:** al editar, se borran los productos viejos antes de saber si los nuevos se guardaron bien.

**Qué se hará:** guardar los productos nuevos primero y borrar los viejos solo si todo salió bien, o hacerlo todo en un solo paso en la base de datos. Si algo falla, la cotización queda como estaba.

## Propuesta para la limpieza nocturna

**Recomendación original: no borrar nunca más. El dueño eligió la opción B** (vencer a los 30 días y borrar al año, con copia).

| Hoy | Propuesta |
|---|---|
| A los 15 días desde que se **creó**, pasa a "anulada" | A los **30 días sin ningún movimiento** (desde la última modificación), pasa a **"vencida"** |
| A los 30 días se **borra para siempre** | **No se borra nada** |
| No queda rastro de cuáles se borraron | Cada cotización vencida queda en la auditoría (número, cliente, vendedor, monto) |
| Corre dos veces por noche | Corre una sola vez por noche |

**Por qué:**
- **Borrar no ahorra nada importante.** Hay unas 4.900 cotizaciones en total, muy poco para la base de datos. Mantenerlas cuesta prácticamente cero.
- **Perder información sí cuesta.** Un cliente puede volver con una cotización vieja en la mano, o el dueño puede querer saber cuánto se cotizó y no se vendió. Con el borrado, eso se pierde.
- **"Vencida" es más honesta que "anulada".** Anulada parece que alguien la canceló. Vencida dice lo que pasó: el cliente no respondió a tiempo. Ese estado ya existe en el sistema y se puede **reciclar** con un clic.
- **Contar desde el último movimiento** evita vencer una cotización que el vendedor sigue negociando.
- **Las listas no se llenan:** la pantalla ya muestra primero lo más reciente, y las vencidas se pueden filtrar.

**Opciones que puedes elegir:**
- **A (recomendada):** vencer a los 30 días sin movimiento, sin borrar nunca.
- **B:** lo mismo que A, pero borrar las vencidas después de **1 año**, guardando antes una copia en la auditoría.
- **C:** apagar la limpieza por completo. No recomendado, porque se acumulan cotizaciones "enviadas" que ya nadie va a responder.

**Las cotizaciones ya borradas:** las de antes del 24-nov se podrían intentar recuperar desde las copias de respaldo de Supabase, si siguen disponibles. Es un trabajo aparte. Dime si te interesa.

## Orden de trabajo

1. Arreglos 1, 2, 3 y 5 en el código.
2. Arreglo 4 con la opción B.
3. Copiar los arreglos a staging ([construacero-staging](../../construacero-staging/)), correr las pruebas automáticas y probar a mano: guardar con conexión lenta, sin conexión, reenvío, auditoría y limpieza.
4. Pedir tu visto bueno y publicar en producción. Se anota el número de la solicitud de cambio y del commit en el caso.
5. Avisar a los vendedores: "si ves PENDIENTE, abre la app con tu PIN y se subirá sola".
6. Revisar al día siguiente en producción que aparezcan registros de CREAR_COTIZACION y que la limpieza corrió una sola vez.

## Riesgos

- **Duplicados al subir las atrapadas:** se evitan con el número de identidad propio del arreglo 1. Las atrapadas desde **antes** de este arreglo no tienen ese número. Si alguna sí había llegado al servidor, podría aparecer dos veces. En producción no hay borradores recientes, así que el riesgo es bajo. Se revisará al publicar.
- **Cotizaciones de clientes nuevos o cambiados:** al subir una atrapada vieja, el servidor vuelve a validar cliente y precios. Si algo cambió, queda como "fallida" visible para el vendedor, en vez de perderse.

## Pendiente

- ~~Elegir la opción para la limpieza nocturna~~ → **B** (2026-11-24).
- ~~Aprobar el plan para empezar~~ → aprobado (2026-11-24).
- Cambios respecto al plan: los borradores sin movimiento pasan a **anulada**, no a vencida (la base no permite borrador → vencida). Descartar una pendiente pide confirmación, pero no deja copia en la auditoría (sin conexión no se puede). Las ventas rápidas sin conexión tienen el mismo defecto, pero quedan fuera (N32) por el riesgo de ventas dobles. La prueba en pantalla mostró que la cotización pendiente llega como **borrador** (no se envía sola); los avisos se ajustaron para decirlo.
