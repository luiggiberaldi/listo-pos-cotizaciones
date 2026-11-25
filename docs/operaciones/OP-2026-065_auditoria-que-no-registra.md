# OP-2026-065 — ¿Por qué la auditoría no está registrando?

**Fecha:** 2026-11-24 · **Entorno revisado:** producción (solo lectura, nada se cambió) · **Estado:** 🔴 diagnosticado, sin corregir

## En resumen

- **La auditoría sí funciona en parte:** hoy anotó 122 acciones (despachos, pagos, cotizaciones enviadas, inventario). Lo que falla es que **varias acciones se pierden siempre** y nadie se entera.
- **Lo más grave: los inicios de sesión dejaron de anotarse el 31 de agosto de 2026.** Antes se anotaban ~450 por semana; desde entonces casi ninguno. Tampoco se anotan crear/editar cotización, pagos a transportistas, ni crear/editar transportistas y vehículos.
- **Causa:** en esas acciones el servidor responde al usuario **sin esperar** a que la anotación termine de guardarse. El servidor (Cloudflare) "apaga la luz" en cuanto responde, y la anotación queda a medio camino. Es como mandar a alguien a dejar una carta y cerrar la puerta de la oficina antes de que salga.
- **Por qué nadie lo notó:** existe una "alarma" que debería avisar cuando una anotación falla, pero la alarma usa una etiqueta (`auditoria`) que la tabla de avisos no acepta, así que **la alarma también se pierde en silencio**.
- **Devoluciones y designaciones de vendedor del día** (13 y 3 en el último mes) tampoco quedaron anotadas, por otra causa que ya se arregló hoy (OP-2026-059, migración 303). Falta confirmarlo con la próxima devolución real.

## Qué tienes que decidir

Aprobar el arreglo (no se ha tocado nada todavía). El arreglo es pequeño: hacer que el servidor espere a que la anotación se guarde (o le pida a Cloudflare "no apagues hasta terminar") y corregir la etiqueta de la alarma. Se probaría primero en staging (la copia de pruebas).

## Qué se encontró (detalle)

### 1. Anotaciones que se pierden porque el servidor no las espera

Inicios de sesión por semana (tabla `auditoria`):

| Semana | Inicios correctos | Inicios fallidos | Otras acciones |
|---|---|---|---|
| 2026-08-17 | 488 | 23 | 532 |
| 2026-08-24 | 384 | 64 | 591 |
| **2026-08-31** | **0** | 96 | 732 |
| 2026-09-21 a hoy | 0 a 6 por semana | 0 | 500–900 |

El corte coincide con el cambio `fd7d6bf9` del 28-ago-2026 ("auditoría no bloqueante"), que dejó la anotación del inicio de sesión sin esperar (`void audit(...)` en `api/handlers/auth-operators.js`). Las otras acciones de la tabla siguen bien porque sí se esperan.

Llamadas del servidor que tienen el mismo problema (no esperan la anotación):

| Archivo | Acción | En la base |
|---|---|---|
| `api/handlers/auth-operators.js:79, 99` | LOGIN_FALLIDO, LOGIN_EXITOSO | casi nada desde el 31-ago (último: 06-nov) |
| `api/handlers/cotizaciones.js:174` | CREAR_COTIZACION / EDITAR_COTIZACION | **nunca** (138 cotizaciones creadas en 7 días, 0 anotadas). Ya registrado como falla N20 (OP-062) |
| `api/handlers/transportistas.js:339, 464, 523, 609` | PAGAR / REVERTIR_PAGO_TRANSPORTISTA | nunca |
| `api/handlers/admin.js:1532, 1612, 1674` | CREAR / ACTUALIZAR / ELIMINAR transportista | nunca (solo 1 en septiembre) |
| `api/handlers/vehiculos.js:219, 323, 373` | CREAR / ACTUALIZAR / ELIMINAR vehículo | nunca |
| `api/handlers/despachos.js:333` | CREAR_DESPACHO (una de las vías) | a veces sí (222 en total); puede perder algunas |

### 2. La alarma de "auditoría rechazada" se descarta sin avisar

`api/lib/audit.js` anota los fallos en la tabla `system_logs` con origen `auditoria`. Esa tabla solo acepta los orígenes `frontend, worker, supabase, worker-cron`, así que la base rechaza el aviso, y el programa no revisa la respuesta. Resultado: 0 avisos de auditoría en `system_logs`, aunque sí hay fallos. Lo mismo vale para el "rescate" que guarda como SISTEMA una anotación rechazada: si el rescate falla, nadie lo sabe.

### 3. Devoluciones, descuentos y designaciones (ya arreglado, falta confirmar)

Usaban categorías (`DESPACHO`, `COMISIONES`, `CONFIG`) que la base no aceptaba hasta la migración 303, aplicada hoy con OP-2026-059. Por eso las 13 devoluciones y 3 designaciones del último mes no tienen anotación. Desde la migración no ha habido devoluciones, así que **todavía no está comprobado** con un caso real. Las anotaciones perdidas antes de hoy no se pueden recuperar.

### 4. Acciones del programa que nunca aparecen en la base

Además de las anteriores: `ABONO_RECHAZADO`, `ACTUALIZAR_PROVEEDOR`, `DESACTIVAR_PROVEEDOR`, `ACTUALIZAR_TRANSACCION_CXP`, `BATCH_PRICE_UPDATE`, `BATCH_PRICE_RESTORE`, `BATCH_INGEST_PRODUCTOS`, `LIMPIAR_INVENTARIO`, `REVERTIR_CARGO_CXC`, `FACTURAR_PRESTAMO`, `DEVOLVER_PRESTAMO`, `REASIGNAR_CLIENTES_BULK`, `CORREGIR_CODIGO_EXTERNO`, `RECALCULO_SALDO_FALLIDO`. Estas sí esperan la anotación; lo más probable es que simplemente no se hayan usado (o usaban categorías ya corregidas en 303). No se comprobó una por una.

## Arreglo propuesto (sin aplicar)

1. Hacer que todas las llamadas a `registrarAuditoria` se esperen, o pasarlas por `waitUntil` (pedirle a Cloudflare que no termine hasta guardar), como ya hace `api/lib/notificarPush.js`. Así el inicio de sesión sigue siendo rápido.
2. En `api/lib/audit.js`, usar el origen `worker` (aceptado) en la alarma y guardar `auditoria` dentro de `meta`; o agregar `auditoria` a la lista de orígenes con una migración.
3. Repetir en `construacero-staging/`, probar en staging (iniciar sesión, crear cotización, pagar transportista, crear vehículo, devolución) y comprobar que cada una aparece en la tabla.
4. Publicar en producción con su solicitud de cambio.

## Cómo se revisó

- Consultas de **solo lectura** a la base de producción (`oyfyuszgjwcepjpngclv`) con el token de Supabase del archivo `.env`, autorizado por el usuario en el chat. Consultas en `tmp/op065/` (fuera del repositorio).
- Lectura del código publicado (`origin/main`): `api/lib/audit.js` es igual al publicado.
- No se cambió nada en ninguna base ni en el código.

## Pendiente / sin verificar

- No se revisó staging en la base (solo el código, que tiene la misma forma).
- No se midió cuántos CREAR_DESPACHO se perdieron.
- Devoluciones después de la migración 303: falta ver una real.
