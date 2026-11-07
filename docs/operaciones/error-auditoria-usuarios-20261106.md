# Error en Auditoría: "permission denied for table usuarios"

**Fecha:** 2026-11-06 · **Tipo:** diagnóstico de solo lectura (no se cambió nada) · **Estado:** **arreglado y publicado en producción el 2026-11-07** (solicitud de cambio #31, unida a `main` con el commit `cf9fb263`).

## Estado final (2026-11-07)

- **Lo que se arregló:** el buscador de Auditoría → Por Despacho ya pide solo las columnas que usa de la tabla de usuarios. Ya no falla con "permission denied". Se comprobó en staging (de error a respuesta correcta) antes de publicar.
- **Protección nueva:** una prueba automática (`src/utils/__tests__/noPedirTodoDeUsuarios.test.js`) revisa todo el código y avisa si alguien vuelve a pedir "todas las columnas" de `usuarios`.
- **Lo que queda abierto:** el error 500 de la lista de Auditoría (`limit=50`) no se pudo reproducir. Si vuelve a aparecer, hay que anotar la hora exacta para buscar los registros de error.
- **Qué hacer tú:** entra como jefe a Auditoría → Por Despacho, busca el 4547 y pulsa "Generar Reporte". Debe abrir el reporte. Si sigue igual, recarga la página (Ctrl + F5) para cargar la versión nueva.

## En resumen

En **Auditoría → Por Despacho**, al buscar un número (ej. 4547) sale el aviso rojo "Error al consultar despacho: permission denied for table usuarios". **No es un fallo nuevo ni lo causaron los cambios de hoy.** La pantalla le pide a la base de datos *todas* las columnas de la tabla de usuarios, y desde septiembre la base de datos **no deja leer dos columnas** (los códigos secretos de los PIN). Al pedir "todas", la base rechaza el pedido completo. El arreglo es pedir solo las columnas que la pantalla usa.

## Qué pasa exactamente

- La base tiene una regla de seguridad (migración 241, 15/09/2026): nadie, ni siquiera desde la aplicación, puede leer `pin_hash` y `pin_salt` de la tabla `usuarios`. Se verificó en producción: las otras 16 columnas sí se pueden leer.
- `src/views/AuditoriaView.jsx` (línea 555, buscador por despacho) pide el vendedor con `usuarios(*)` ("todas las columnas"). Esa petición incluye las dos prohibidas y falla con el código 42501.
- Es la **única** consulta del sistema que lee `usuarios` con `*` (se revisaron `src` y `api`).
- El buscador de auditoría se escribió en junio, antes de la regla de septiembre. Probablemente falla desde que se aplicó la regla en producción.

## Efecto para el usuario

- **Por Despacho:** no se puede generar el reporte de ningún despacho.
- **Por Cliente:** no lo toca esta consulta; no hay evidencia de que falle (no se probó a ojo).
- La lista general de Auditoría ("24.521 registros") cargó el contador sin problema.

## El otro error de la captura (500 en la lista de auditoría)

El pedido de la lista (`auditoria?...limit=50`) devolvió error 500. **No se pudo reproducir:** la consulta equivalente tarda 0,3 ms en la base, hay índice por fecha y con permisos de servicio responde bien. No se pudo simular el rol exacto del usuario (la herramienta no permite cambiar de rol) ni leer los registros de errores (esa tabla de logs no está disponible por la API). Es probable que sea un fallo puntual o de tiempo de espera; si se repite, hay que capturar la hora exacta para buscarlo.

Otro dato: la captura viene de `localhost` (versión de desarrollo) conectada a la base de producción, con el operador "enzo patti" (jefe). Es la misma base, así que el error también ocurre en la web publicada.

## Arreglo (aplicado y publicado)

1. Cambiar `usuarios(*)` por las columnas que realmente usa el reporte (`id, nombre, rol, color, codigo, telefono`). **Hecho** en `src/views/AuditoriaView.jsx`.
2. Una prueba automática que impida volver a pedir `*` de `usuarios`. **Hecho.**
3. Probar en staging (donde ocurre lo mismo) y publicar. **Hecho:** staging pasó de error 403 a 200; publicado en producción el 2026-11-07.

Es un cambio de una línea, solo de lectura; no toca datos ni la base de datos.

Scripts usados (solo lectura): `tmp/diagnostico-auditoria-usuarios.mjs`, `tmp/diag2.mjs`, `tmp/diag3.mjs`, `tmp/diag4.mjs`.
