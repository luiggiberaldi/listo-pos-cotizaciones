# OP-2026-108 — Auditoría del plan "Auditoría 2.0" (OP-2026-066)

**Fecha:** 2026-11-27 · **Entorno revisado:** código publicado (`origin/main`, commit `7c6e8ecd`, solo lectura) · **Estado:** ✅ auditoría terminada, sin cambios de código ni base de datos · **Plan auditado:** [OP-2026-066](../plans/OP-2026-066_plan-auditoria-2.md)

## En resumen

- **Veredicto:** la idea general del plan es **muy buena** (tres capas de vigilancia, registro intocable y entrega por fases), pero **NO está listo para ejecutarse tal cual**. Necesita ajustes antes de aprobarlo.
- **3 problemas técnicos graves:** una de las piezas prometidas (*"cámara automática al crear tablas nuevas dentro de la base"*) **no está permitida en Supabase**; el plan no explica cómo el servidor le pasará el usuario a la base de datos de forma segura; y las "cámaras" chocarían con la restauración de respaldos de 26 tablas (OP-2026-097) y las limpiezas de pruebas en staging.
- **4 huecos importantes de seguridad y permisos:** hoy el rol **Administración está bloqueado** en la auditoría (aunque el plan dice que debe verla), el **Supervisor lee directo de la base de datos** (ocultarle precios solo en pantalla no sería seguro), quitar el permiso al **Jefe** no impide borrados desde el servidor si hay un error, y el mecanismo para no perder anotaciones (`waitUntil`) hoy solo está conectado en 4 rutas.
- **Desactualizado en 2 puntos:** la auditoría de **cotizaciones ya se arregló** en OP-2026-069, y el plan no contempla el impacto en los **probadores automáticos nocturnos** creados después (regla OP-2026-105).
- **Recomendación:** corregir el plan con estos 9 ajustes y empezar únicamente por una **Fase 0 ajustada** en staging (arreglar lo que hoy se pierde en producción + alarma + candado real de no borrado).

---

## Hallazgos críticos (impiden o rompen el plan si se ejecuta tal cual)

### 1. La "cámara automática para tablas nuevas" dentro de la base NO funciona en Supabase
- **Qué dice el plan (Fase 3):** crear una regla dentro de la base de datos que, al crear una tabla nueva, le instale la cámara sola (en PostgreSQL eso se llama *Event Trigger*).
- **Qué se verificó:** en Supabase (la base en la nube que usa construacero), los usuarios no tienen permiso de *superusuario* para crear ese tipo de regla global. La migración fallaría al aplicarse.
- **Cómo corregirlo en el plan:** quitar esa pieza de la base de datos y apoyarse 100 % en la **revisión automática antes de publicar** (pruebas que revisan las tablas del sistema y bloquean la publicación si una tabla nueva no tiene cámara ni está en la lista de excluidas).

### 2. Falta el mecanismo exacto (y seguro) para que la base sepa "quién hizo el cambio"
- **Qué dice el plan (Fase 1):** *"el servidor ya sabe qué operador está conectado. Lo pasará a la base en cada operación, y la base lo pega al cambio."*
- **Qué se verificó:** el servidor (Cloudflare Worker) no mantiene una conexión fija con la base; cada acción es una llamada web independiente (PostgREST) usando la llave maestra (`service_role`). Además, en `api/handlers/` varias rutas arman sus cabeceras a mano en vez de usar `supaServiceHeaders` (`api/lib/auth.js:15`).
- **Riesgo:** sin un mecanismo estándar, las cámaras en la base grabarían casi todo como "sistema" en vez del operador real. Y si se usa un encabezado web (por ejemplo `x-operator-id`), la cámara **solo puede confiar en él cuando la llamada viene con la llave del servidor (`service_role`)**, nunca desde el navegador, para que nadie pueda suplantar a otro usuario.
- **Cómo corregirlo en el plan:** definir en Fase 1 un estándar único en el servidor que envíe `x-operator-id`, `x-operator-nombre` y `x-request-id` en todas las llamadas a Supabase, y que la cámara en la base valide que la llamada sea `service_role` antes de leerlos.

### 3. Choque con la restauración de respaldos (OP-2026-097) y las limpiezas de staging
- **Qué se verificó:**
  - En producción existe la restauración atómica de 26 tablas (`supabase/migrations/318_prod_respaldo_restauracion_atomica_26_tablas.sql`).
  - En staging existen rutas de limpieza completa (`handleResetOperacional` y `handleTesterClearAll` en `api/handlers/admin.js:1005-1071`) que borran `auditoria` y tablas operativas.
- **Qué pasaría si se aplica el plan tal cual:**
  1. Al restaurar un respaldo o limpiar staging, las cámaras de la Fase 1 grabarían **miles de cambios falsos de golpe**, lo que podría agotar el tiempo límite de la operación y llenar `auditoria_cambios` de basura.
  2. Si se bloquea todo borrado en `auditoria` sin excepción controlada para staging, las limpiezas de pruebas dejarían de funcionar.
- **Cómo corregirlo en el plan:** agregar en Fase 1 una bandera interna de sesión solo utilizable por la función de restauración (para pausar las cámaras mientras se restaura y dejar una sola anotación *"RESPALDO RESTAURADO"*), y definir cómo convive el candado de no borrado con los entornos de pruebas.

---

## Hallazgos importantes (seguridad, permisos y operación)

### 4. Contradicción de roles: "Administración" hoy está bloqueada y "Supervisor" lee directo de la base
- **Qué dice el plan:** *"Decidido por el dueño (2026-11-24): el supervisor NO ve los cambios de precios ni de dinero. Los ven jefe y administrador."*
- **Qué se verificó en el código actual:**
  - El menú lateral (`src/components/layout/AppLayout.jsx:102`) y la barra inferior (`BottomNav.jsx:29`) muestran "Auditoría" a `administracion`, **pero** tanto el servidor (`api/handlers/audit.js:11, 52`) como el gancho de pantalla (`src/hooks/useAuditoria.js:35`) **solo permiten entrar a `desarrollador`, `jefe` y `supervisor`**, dejando fuera a `administracion`.
  - Además, la pantalla actual (`src/hooks/useAuditoria.js:15-23`) consulta la tabla `auditoria` **directamente desde el navegador a Supabase**, donde la política `auditoria_supervisor_select` (`033_fix_auditoria_rls_and_constraints.sql:8`) le permite al supervisor leer todas las filas sin filtro.
- **Riesgo:** si ocultar precios y dinero al supervisor se hace solo en la pantalla, el permiso abierto en la base seguiría exponiendo esos datos.
- **Cómo corregirlo en el plan:** incluir en Fase 0/Fase 4: (a) habilitar `administracion` en `api/handlers/audit.js`, y (b) hacer que la pantalla lea la auditoría **exclusivamente a través del servidor** (o mediante una vista restringida en la base), cerrando la lectura directa sin filtro para `supervisor`.

### 5. Quitar `auditoria_jefe_all` no garantiza por sí solo que la auditoría sea intocable
- **Qué se verificó:** `096_rol_jefe.sql:25` le da a `jefe` permiso `FOR ALL` sobre `auditoria`, lo que anula la política `auditoria_no_delete` de `033` (porque en PostgreSQL las políticas permisivas se suman).
- **Qué falta en el plan:** quitar `auditoria_jefe_all` cierra la puerta desde el navegador, pero el servidor usa la llave maestra (`service_role`), que ignora esas reglas.
- **Cómo corregirlo en el plan:** en Fase 0, además de reemplazar `auditoria_jefe_all` por permiso de **solo lectura**, agregar un candado directo en la tabla (`BEFORE UPDATE OR DELETE` trigger en `auditoria`) que impida editar o borrar filas en producción incluso desde el servidor.

### 6. `waitUntil` hoy solo está conectado en 4 rutas de todo el servidor
- **Qué se verificó:** en `worker.js` (`57, 165, 190, 241, 246`), `conWaitUntil(env, ctx)` solo se entrega a 4 funciones (`handleGuardarCotizacion`, `handleCrearDespacho`, `handleVentaRapida`, `handleActualizarEstadoDespacho`).
- **Qué implica:** las rutas que hoy pierden anotaciones (`handleSwitchOperator` para inicios de sesión, `handleAdmin` para transportistas, `transportistas.js` y `vehiculos.js`) **no reciben `waitUntil`**.
- **Cómo corregirlo en el plan:** en Fase 0, envolver `env` con `conWaitUntil(env, ctx)` **una sola vez al entrar a `/api/`** en `worker.js`, para que todas las rutas presentes y futuras lo tengan disponible automáticamente.

### 7. Respaldo de `auditoria` recortado a 5.000 filas y ausencia de `auditoria_cambios`
- **Qué se verificó:** `handleBackup` (`api/handlers/admin.js:387`) descarga `auditoria` con `limit=5000`, aunque la tabla ya tiene ~26.000 filas. El plan tampoco define si la nueva tabla `auditoria_cambios` se incluye en los respaldos o en el archivo histórico.
- **Cómo corregirlo en el plan:** dejar explícito en Fase 1/Fase 5 que `auditoria` y `auditoria_cambios` se respaldan en el respaldo externo semanal (Google Drive, OP-2026-028) y documentar qué cubre el respaldo rápido de la app.

---

## Puntos desactualizados desde el 24 de noviembre

### 8. Cotizaciones ya se arregló (OP-2026-069); lista real de llamadas sin esperar hoy
- **Ya arreglado:** `api/handlers/cotizaciones.js:229` ya usa `env.waitUntil(auditoria)` desde OP-2026-069 (publicado el 24-nov).
- **Siguen perdiéndose hoy (confirmado en `origin/main`):**
  - `api/handlers/auth-operators.js:106` (y el login exitoso más abajo): `void audit(...)` → `LOGIN_FALLIDO` y `LOGIN_EXITOSO`.
  - `api/handlers/admin.js:1771, 1851, 1913`: crear/actualizar/desactivar transportistas.
  - `api/handlers/transportistas.js:339, 464, 523, 609`: pagos y reversiones a transportistas.
  - `api/handlers/vehiculos.js:219, 323, 373`: crear/actualizar/eliminar vehículos.
  - `api/handlers/despachos.js:334`: una de las vías de `CREAR_DESPACHO`.
  - **Alarma rota:** `api/lib/audit.js:48` sigue mandando `origen: 'auditoria'` a `system_logs`, que solo acepta `'frontend' | 'worker' | 'supabase'` (`056_system_logs.sql:13`).

---

## Impacto en probadores e inspectores automáticos (regla OP-2026-105)

El plan original se escribió antes de OP-2026-103, OP-2026-104 y OP-2026-105 y **no evalúa** el impacto en los vigilantes automáticos activos:

| Probador / Inspector | ¿Se ve afectado? | Qué hay que hacer al ejecutar el plan |
|---|---|---|
| **Auditor de saldos y comisiones en producción** (2:00 a. m., `auditor-saldos-main.yml` / `scripts/auditor-saldos-main.mjs`) | **Sí (Fase 3)** | Hoy ya revisa `public.auditoria` (`W4_reversiones_sin_auditoria`, línea 156). El "chequeo diario de salud" de Fase 3 debe **integrarse en este auditor** en vez de duplicar un proceso nocturno nuevo. |
| **Probador nocturno completo en staging** (1:00 a. m., `staging-e2e-nightly.yml`) | **Sí (Fases 0 y 1)** | Crea y borra datos de prueba en staging. Si Fase 0 bloquea borrados en `auditoria` sin excepción para staging, o Fase 1 dispara cámaras en limpiezas masivas, el probador nocturno podría fallar o llenarse de ruido. |
| **Verificador diario de ventas reales en staging** (12:00 a. m. L–S, `verificador-diario-staging.yml`) | **Sí (Fase 1)** | Replica ventas reales en staging; hay que verificar que la latencia de los disparadores no supere los tiempos esperados y que la limpieza final no deje registros residuales. |
| **Pruebas automáticas (`vitest`)** | **Sí (Fases 0, 2 y 3)** | Más de 15 archivos de prueba simulan `registrarAuditoria` (`api/handlers/__tests__/`). Si cambia la firma o el uso de `waitUntil`, deben actualizarse y añadirse pruebas nuevas para el catálogo y la cobertura. |
| **Avisos programados del servidor** (`wrangler.toml`: 8:00 a. m. cobranza y limpieza nocturna) | **Sí (Fase 1)** | Los cambios hechos por la limpieza nocturna (`runCleanupCotizaciones`, `runPurgeTrackingImages`) entrarán a las cámaras sin operador humano; deben quedar claramente marcados como `sistema (cron)` y no como "cambio manual sospechoso". |

---

## Orden recomendado si decides avanzar

1. **Actualizar `OP-2026-066`** incorporando estas 9 correcciones (sin tocar código todavía).
2. **Aprobar y ejecutar solo la Fase 0 en staging** (riesgo bajo, beneficio inmediato):
   - Conectar `conWaitUntil` a todo `/api/` en `worker.js`.
   - Pasar todas las llamadas sueltas (`auth-operators`, `transportistas`, `vehiculos`, `admin`, `despachos`) a `waitUntil` (o `await`).
   - Corregir `origen: 'worker'` en la alarma de `api/lib/audit.js`.
   - Reemplazar `auditoria_jefe_all` por solo lectura + candado real contra `UPDATE/DELETE` en producción.
   - Habilitar lectura para `administracion` en `api/handlers/audit.js`.
3. **Evaluar Fases 1 a 5 después**, con la arquitectura de encabezados PostgREST y la compatibilidad con restauración y probadores ya definidas por escrito.

## Pendiente / sin verificar

- Esta auditoría se hizo **100 % en solo lectura** sobre el código publicado (`origin/main`); no se ejecutaron consultas a la base de producción ni a staging.
- No se modificó todavía el documento `OP-2026-066` ni ningún archivo de código; queda a la espera de tu aprobación para actualizar el plan o arrancar la Fase 0.
