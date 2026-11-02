# Auditoría del sistema de notificaciones

**Fecha:** 2026-11-02 · **Alcance:** notificaciones push (avisos al teléfono/PC con la app cerrada), alertas internas (campana, sonido, título parpadeante) y su seguridad. Solo lectura: no se cambió código ni datos. Producción consultada en modo lectura.

## En resumen

Las **alertas dentro de la app** (campana, sonido, ícono) funcionan mientras la app está abierta. Las **notificaciones push** (las que llegan con la app cerrada) **hoy casi no llegan a nadie**: en producción hay **1 sola suscripción** (de junio, a nombre de la cuenta compartida "EMPRESA", en un iPhone) para 13 usuarios. La causa es que, desde que el sistema identifica a cada operador por su PIN, el código de notificaciones quedó apuntando a la cuenta compartida y no al operador. Además hay un **riesgo de seguridad**: cualquier sesión puede enviar notificaciones con el texto y enlace que quiera a cualquier persona.

## Cómo funciona hoy

1. El operador pulsa el botón de activar notificaciones → el navegador crea una suscripción → se guarda en la tabla `push_subscriptions` (`api/handlers/push.js`).
2. Cuando ocurre algo (despacho creado, cotización enviada, venta rápida), **el navegador de quien hizo la acción** llama a `/api/push/send` indicando a qué rol avisar (`useDespachos`, `useCotizaciones`, `useVentaRapida`).
3. El Worker busca los usuarios de ese rol, toma sus suscripciones y envía el aviso cifrado (`api/lib/webpush.js`).
4. El teléfono lo muestra (`src/sw.js`). Si la app está abierta y enfocada, lo silencia porque la alerta interna ya avisa.

## Hallazgos

| # | Gravedad | Hallazgo | Evidencia |
|---|---|---|---|
| 1 | **Alta** | **Las push no llegan a los operadores.** Las suscripciones se guardan con `user.operator_id \|\| user.id`, pero `verifyAuth` deja `operator_id` en null a propósito (la sesión de cuenta no es un operador). Todo queda bajo la cuenta compartida, y al avisar "al rol supervisor" se buscan operadores que no tienen suscripción. | Producción: 1 suscripción, usuario "EMPRESA" (rol `vendedor_sin_comision`), 2026-06-01, host `web.push.apple.com`; 13 usuarios. 0 registros de push en 30 días. |
| 2 | **Alta (seguridad)** | **Cualquier sesión puede enviar notificaciones a cualquiera**, con título, mensaje y enlace arbitrarios. No se verifica el rol del que envía ni que el evento exista. Sirve para suplantar ("Tu cotización fue aprobada, entra aquí") o engañar con enlaces. El límite de envíos es en memoria por IP y se reinicia. | `push.js` líneas 76-139: solo exige sesión de cuenta. |
| 3 | **Media (seguridad)** | Los datos `targetUserId` y `targetRole` se pegan directo en la consulta a la base sin validar (un valor manipulado puede alterar el filtro). | `push.js` líneas 95-120. |
| 4 | **Media (seguridad)** | La suscripción acepta **cualquier dirección** como destino y luego el Worker le envía una petición. Solo deberían aceptarse los servicios push reales (Google, Mozilla, Apple, Microsoft). | `push.js` líneas 27-47 y `webpush.js` línea 56. |
| 5 | **Media** | **Volver a suscribir el mismo teléfono puede fallar.** La tabla real tiene `UNIQUE(endpoint)` (la migración 057 decía `UNIQUE(usuario_id, endpoint)`), y el guardado no indica sobre qué columna resolver el choque. Por código, un segundo intento termina en "Error al guardar suscripción". *No reproducido en vivo.* | Restricciones de producción vs. `push.js` línea 39. |
| 6 | **Media** | **El aviso depende del navegador de quien hace la acción.** Si esa persona cierra la pestaña o pierde internet justo después de crear un despacho, nadie recibe el aviso. Debería enviarse desde el servidor al completar la operación. | `sendPushNotification` en el cliente, con errores ignorados. |
| 7 | **Media** | Formato de cifrado antiguo (`aesgcm`) y contacto VAPID de ejemplo (`mailto:admin@listpos.com`). Algunos servicios (sobre todo Apple) pueden rechazar esas combinaciones. *Por revisar con una prueba real.* | `webpush.js` líneas 37 y 82. |
| 8 | **Baja** | **Sin registro de entregas ni fallos**: los errores van a `console.error` del Worker. No se sabe cuántas llegan. | 0 logs de push en 30 días. |
| 9 | **Baja** | Si el servidor no responde la clave VAPID, el cliente usa una clave de respaldo fija: si cambia la del servidor, las suscripciones nuevas quedarían inservibles sin avisar. | `usePushNotifications.js` línea 69. |
| 10 | **Baja** | La tabla `push_subscriptions` da todos los permisos (incluido TRUNCATE) a `anon` y `authenticated`. Las políticas de fila protegen lectura y escritura por la API, pero conviene cerrarlos como se hizo en la migración 288. | Permisos de producción. |

## Lo que está bien

- Las alertas internas: sonido normal y urgente, ícono con contador, título parpadeante, notificaciones separadas por usuario.
- Limpieza automática de suscripciones muertas (errores 404/410).
- Al tocar una notificación, la app se abre en la pantalla correcta.
- La clave privada de VAPID vive en el servidor, no en la web.

## Propuesta de arreglo (por fases)

**Fase 1 — sin tocar la base de datos (riesgo bajo, primero en staging):**
- Usar la validación de operador (PIN) en suscribir, desuscribir y enviar. Así cada suscripción queda a nombre del operador.
- Enviar solo si el rol del que envía lo permite y validar `targetUserId` y `targetRole`.
- Aceptar solo destinos de servicios push reales.
- Corregir el guardado para que re-suscribir sirva (resolver el choque por `endpoint`).
- Registrar entregas y fallos en los logs del sistema (resumen, sin textos).

**Fase 2 — envío desde el servidor:** que el aviso salga del Worker cuando se completa el despacho/cotización/venta, no del navegador. Cada operador tendrá que **volver a activar las notificaciones** una vez después de la Fase 1.

**Fase 3 — compatibilidad:** pasar al cifrado estándar (`aes128gcm`), poner un correo de contacto real en VAPID y probar con Android, PC e iPhone.

**Fase 4 — base de datos (requiere autorización y respaldo):** cerrar permisos de `anon` y `authenticated` y alinear la restricción de unicidad con la migración. Primero staging.

## Pruebas pendientes (no se hicieron en esta auditoría)

- Enviar una notificación real a un dispositivo (necesita un teléfono con la app instalada y permiso de notificaciones).
- Confirmar que las variables VAPID están cargadas en el Worker de producción (los secretos no son visibles desde aquí).
- Reproducir el hallazgo 5 en staging.

## Avance — Fase 1 (publicada 2026-11-02) y Fase 2

**Fase 1 (PR #10, en producción):** suscripciones y envíos por operador (PIN), destinos solo en servicios push reales, roles/destino/enlace validados, aviso a todos solo para dirección, resumen de entregas en `system_logs` (categoría `PUSH`).

**Fase 2 (este cambio):** los avisos de despachos salen **desde el servidor** al terminar la operación, ya no desde el navegador de quien actuó:

| Evento | Quién recibe |
|---|---|
| Despacho creado / venta rápida creada | supervisor, administración, jefe |
| Despacho en ruta | vendedor, logística |
| Despacho entregado | vendedor |
| Despacho cancelado | todos los roles |

- El aviso se envía **después** de responder al usuario (`waitUntil`), así que no hace más lento el guardado. Nunca se avisa a quien hizo la acción. Si el estado no cambia (reintento), no se repite el aviso.
- Los datos (número de cotización, cliente, cobro a destino) se leen de la base de datos, no del navegador.
- Corrige una consecuencia de la Fase 1: "Despacho cancelado" iba a todos y ahora la Fase 1 lo habría bloqueado para vendedores/logística; el servidor ya lo envía bien.
- **Siguen desde el navegador** (porque esas operaciones se guardan directo en la base, sin pasar por el servidor): cotización enviada con cliente ajeno, cotización anulada, cotización aceptada y venta rápida con cliente ajeno. Pasarlas al servidor requeriría un trigger en la base de datos (cambio mayor, para después).
- Pruebas: 7 nuevas del ayudante; suites completas pasan (API 315, staging 128, frontend 519). Probado contra la base real de staging con operadores reales: el vendedor crea → avisa al supervisor/jefe y no a sí mismo; el supervisor entrega → avisa a vendedores; despacho inexistente → no avisa; limpieza hecha.
- **No probado:** entrega real a un teléfono (ver pendientes de la Fase 1).

## Hallazgo crítico al probar (2026-11-02): el cifrado de los avisos estaba mal

Al intentar la "prueba real" se construyó un receptor de referencia (validado contra la librería estándar `web-push` en los dos formatos) y se le envió un aviso con nuestro código. **No pudo descifrarlo**: el formato antiguo `aesgcm` estaba implementado sin el contexto que exige el estándar. Un navegador real descarta ese aviso, o sea que **las notificaciones push nunca pudieron mostrarse en un dispositivo**, aunque el servidor dijera "enviado". La firma VAPID sí era correcta.

**Corrección (incluida en el PR de la Fase 2):** `api/lib/webpush.js` ahora usa el cifrado estándar RFC 8291 (`aes128gcm`), compatible con Chrome, Firefox, Edge y Safari/iPhone. Nuevo `VAPID_SUBJECT` opcional para poner un correo de contacto real (por defecto sigue `mailto:admin@listpos.com`; conviene configurar uno real en el Worker).

**Verificación:**
- Prueba permanente `api/lib/__tests__/webpushCifrado.test.js`: el receptor descifra el aviso y la firma VAPID es válida.
- Cadena completa contra la base real de staging con un receptor local: despacho → servidor lee datos → envía → el "dispositivo" descifra `{"title":"🚚 Orden de Despacho Creada","body":"Despacho para cotización #03254 — …","url":"/despachos"}`; el registro queda en `system_logs`. Limpieza hecha.
- Suites completas: API 317, staging 130, frontend 519.

**Sigue sin probarse:** la entrega por Google/Apple/Mozilla con un teléfono real. El Chrome automatizado no puede suscribirse a push (Google rechaza el registro), por eso se usó el receptor de referencia.
