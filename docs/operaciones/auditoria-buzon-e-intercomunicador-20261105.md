# Buzón de sugerencias: revisión y lecciones del intercomunicador de "Donde Juancho"

**Fecha:** 2026-11-05 · Solo lectura (no se cambió código ni datos de producción).

## En resumen

- **El Buzón funciona** en staging de punta a punta: el vendedor envía, ve su historial, no ve mensajes ajenos; el desarrollador los ve, los marca y los borra.
- **Su gran debilidad es que nadie se entera de que llegó un mensaje.** En producción hay 3 mensajes; 2 están "pendientes" desde el 27/10 (9 días) sin que nadie los abriera. El Buzón no avisa al desarrollador (ni campana ni push); solo muestra un número dentro de la pestaña.
- El intercomunicador de Donde Juancho resolvió justo eso (push + sonido + abrir el chat al tocar) y varias cosas más que valen la pena copiar.

## Lo comprobado en el Buzón (staging, prueba real)

| Prueba | Resultado |
|---|---|
| Vendedor entra con PIN y envía un mensaje | Bien |
| Vendedor ve su historial | Bien |
| Vendedor NO ve mensajes ajenos | Bien |
| Vendedor NO puede cambiar el estado de su mensaje | **No se cumple**: sí pudo cambiarlo a "resuelto" (hueco menor; la regla dice que solo el desarrollador). Falta verificar si pasa igual en producción. |
| Desarrollador ve / marca leído / elimina | Bien |
| Limpieza de la prueba | 0 restos |

No se pudo probar en producción (no hay acceso a la cuenta ni al código de desarrollador de producción). Si la pantalla "Buzón vacío" de la captura es de producción, **sería un error**, porque hay 3 mensajes guardados; si es de staging, es lo esperado (staging no tiene mensajes).

Otros puntos del Buzón actual: el botón flotante solo aparece en el Inicio (en el teléfono, solo ahí); el "visto" de las respuestas se guarda en el navegador (si cambia de equipo, vuelve a salir como nuevo); el historial se refresca por consulta cada 15–30 s, no en vivo.

## Qué tiene el intercomunicador (Donde Juancho)

Chat caja ↔ supervisores: mensajes en tiempo real (Supabase Realtime), historial de 30, no leídos por dispositivo (cursor de lectura en el servidor), push con la app cerrada (Edge Function + VAPID + service worker), sonido de alerta con la app abierta, mensaje fallido con botón de reintento, editar el propio mensaje hasta 15 min (validado en servidor y cliente), color/avatar por persona, y documentación con runbook (`docs/INTERCOMUNICADOR_PUSH_NOTIFICACIONES.md`).

## Qué aplicar al Buzón (por prioridad)

1. **Avisar cuando llega un mensaje.** Push + campana al desarrollador (y que al tocarlo abra directo la pestaña Buzón). Ya existe la infraestructura de push que se usó para el aviso de cobranza (`enviarPush` con `usuarioIds`). Es lo que más valor da.
2. **Avisar al vendedor cuando le responden** (hoy solo ve un número si abre el botón y solo en ese equipo).
3. **"Visto" guardado en el servidor**, no en el navegador (el intercomunicador usa cursores de lectura por dispositivo).
4. **Editar o retirar el propio mensaje** durante unos minutos (regla igual que el intercomunicador: 15 min, validada en el servidor).
5. **Cerrar el hueco de permisos** (el vendedor no debe poder cambiar el estado).
6. **Botón visible en más pantallas** (hoy solo en Inicio).
7. **Tiempo real** (Realtime) para que el Buzón del desarrollador se actualice solo. Menor prioridad.
8. **Buenas prácticas de operación que mostró el proyecto:** registrar la causa real de fallos de entrega (ahí un log mal leído ocultó el error de claves durante días) y dejar un "runbook" de qué mirar cuando algo no llega.

## Lo que NO conviene copiar

Avatares/colores por persona, "marcar como leído" desde la notificación, y tantos ajustes de sonido: el Buzón es de baja frecuencia (3 mensajes en 3 meses).

## Pendiente de decisión del dueño

Si se quiere construir el punto 1 (y 2–5) primero en staging.

## Actualización (2026-11-06): por qué el Buzón del desarrollador salía vacío en producción

- **Causa:** las reglas de seguridad de la tabla (migración 195) dejaban ver/editar/borrar mensajes ajenos solo si la cuenta compartida llevaba el dato `operator_rol = desarrollador` en su token. Desde la migración 241 el rol sale de la sesión del operador y ese dato ya no existe. En **producción** la cuenta no lo tiene → el desarrollador no veía nada (3 mensajes guardados, todos de Administración, 2 pendientes desde el 27/10).
- **Por qué en staging parecía funcionar:** la cuenta de pruebas de staging conservaba ese dato antiguo (falso positivo). Se retiró para que staging se comporte como producción.
- **Arreglo:** migración `299_buzon_politicas_por_operador.sql` (rollback incluido): las reglas usan `get_rol_actual()` (rol real del operador). Aplicada y probada en **staging**: el desarrollador ve/marca/borra, el vendedor ya no puede cambiar el estado de su mensaje, todos los roles pueden enviar.
- **Pantalla:** botón **Actualizar** y aviso de error visible (antes un fallo de lectura se veía como "Buzón vacío").
- **Estado:** migración 299 **aplicada en producción el 2026-11-06** (reglas verificadas en el catálogo) y botón Actualizar publicado. El dueño confirmó que ya ve los 3 mensajes del Buzón. Reversa: `299_buzon_politicas_por_operador_rollback.sql`.
