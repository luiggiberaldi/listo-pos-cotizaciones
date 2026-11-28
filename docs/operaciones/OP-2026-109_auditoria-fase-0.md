# OP-2026-109 — Auditoría 2.0 (Fase 0): no perder anotaciones, alarma reparada, acceso para Administración y candado anti-borrado

**Fecha:** 2026-11-27 · **Origen:** [OP-2026-065](OP-2026-065_auditoria-que-no-registra.md), [OP-2026-066](../plans/OP-2026-066_plan-auditoria-2.md) y [OP-2026-108](OP-2026-108_auditoria-plan-auditoria-2.md) · **Estado:** ✅ Aplicado y verificado **11/11 en vivo en staging** (`spupqgkdsgohxxfoxydl` / Worker `ac27f904`); producción sin tocar todavía (pendiente de tu aprobación para publicar)

## En resumen

- **Qué se arregló:** la **Fase 0** del plan Auditoría 2.0 ya está programada y probada en local:
  1. **Ya no se pierden anotaciones al responder:** se conectó `waitUntil` (pedirle a Cloudflare *"no apagues hasta terminar de guardar"*) a **todas** las rutas del servidor (`/api/`), y se corrigieron las 12 llamadas sueltas que hoy se perdían (inicios de sesión exitosos/fallidos, transportistas, pagos y reversiones de transportistas, vehículos y una vía de crear despacho).
  2. **Alarma de fallos reparada:** si una anotación llegara a fallar, el aviso a `system_logs` ahora usa `origen: 'worker'` (aceptado por la base) con `suborigen: 'auditoria'` en `meta`, en vez de perderse en silencio.
  3. **Administración ya puede consultar la auditoría:** se habilitó el rol `administracion` en las rutas de lectura del servidor (`/api/admin/audit` y `/stats`) y en la pantalla (`useAuditoria.js`), alineándolo con el permiso que ya existía en la base de datos.
  4. **Candado real contra borrado o edición:** se preparó la migración `319_auditoria_inmutable_fase0.sql` (con su reversión exacta `319_auditoria_inmutable_fase0_rollback.sql`) que quita al rol `jefe` el permiso `FOR ALL` sobre `auditoria` (dejándolo en solo lectura) y agrega un candado directo en la tabla (`BEFORE UPDATE OR DELETE`) para que nadie pueda modificar ni borrar filas de auditoría en producción.
- **Protección automática a futuro:** se agregó una prueba automática que revisa todos los manejadores del servidor y **falla si alguien vuelve a escribir una anotación de auditoría suelta** (sin `await` ni `waitUntil`).
- **Producción:** sin tocar todavía. Primero se prueba en staging.

---

## Cambios realizados

| Archivo | Qué se cambió |
|---|---|
| `docs/plans/OP-2026-066_plan-auditoria-2.md` | Plan corregido con los 9 hallazgos de [OP-2026-108](OP-2026-108_auditoria-plan-auditoria-2.md) (sin Event Trigger en Supabase, estándar de cabeceras PostgREST, compatibilidad con restauración de 26 tablas y probadores automáticos). |
| `worker.js` | `env = conWaitUntil(env, ctx)` conectado una sola vez en la entrada de `/api/` para cubrir todas las rutas presentes y futuras. |
| `api/lib/audit.js` | Alarma en `system_logs` cambiada de `origen: 'auditoria'` (rechazado por la base) a `origen: 'worker'` con `meta.suborigen = 'auditoria'`. |
| `api/handlers/auth-operators.js` | `LOGIN_FALLIDO` y `LOGIN_EXITOSO` pasan por `waitUntil` (o `await` si no existe). |
| `api/handlers/despachos.js` | `CREAR_DESPACHO` pasa por `waitUntil` y guarda `operador.rol` real en vez de fijar `'supervisor'`. |
| `api/handlers/admin.js` | `CREAR_TRANSPORTISTA`, `ACTUALIZAR_TRANSPORTISTA` y `ELIMINAR_O_DESACTIVAR_TRANSPORTISTA` pasan por `waitUntil`. |
| `api/handlers/transportistas.js` | Las 4 vías de `PAGAR_TRANSPORTISTA` y `REVERTIR_PAGO_TRANSPORTISTA` pasan por `waitUntil`. |
| `api/handlers/vehiculos.js` | `CREAR_VEHICULO`, `ACTUALIZAR_VEHICULO` y `ELIMINAR_O_DESACTIVAR_VEHICULO` pasan por `waitUntil`. |
| `api/handlers/audit.js` y `src/hooks/useAuditoria.js` | Rol `administracion` habilitado para consultar auditoría y estadísticas. |
| `supabase/migrations/319_auditoria_inmutable_fase0.sql` (+ `_rollback.sql`) | Reemplaza `auditoria_jefe_all` por `auditoria_jefe_select`, revoca `UPDATE/DELETE` a `anon`/`authenticated` y crea disparador `trg_auditoria_inmutable` (con bandera controlada `app.permitir_limpieza_auditoria = '1'` para mantenimiento/pruebas). |
| `api/lib/__tests__/audit.test.js` y `api/handlers/__tests__/auditFase0Op109.test.js` | Pruebas nuevas de alarma con `origen: 'worker'`, permiso de `administracion`, conexión global de `conWaitUntil` y guardia estática contra llamadas sueltas a `registrarAuditoria`. |

---

## Impacto en probadores e inspectores automáticos (regla OP-2026-105)

| Probador / Inspector | Impacto de Fase 0 | Estado / Acción |
|---|---|---|
| **Probador nocturno en staging (1:00 a. m., `staging-e2e-nightly.yml`)** | Medio al aplicar migración `319` en staging: si alguna rutina de limpieza intenta hacer `DELETE FROM auditoria` sin activar `app.permitir_limpieza_auditoria = '1'`, el disparador la rechazará. | Verificar en staging al aplicar la migración `319` que la limpieza de fixtures siga pasando en verde (la migración ya contempla la bandera `SET LOCAL app.permitir_limpieza_auditoria = '1'`). |
| **Verificador diario de ventas reales en staging (12:00 a. m. L–S, `verificador-diario-staging.yml`)** | Sin impacto negativo: solo agrega registros en segundo plano vía `waitUntil` sin frenar respuestas. | Sin cambios requeridos. |
| **Auditor de saldos y comisiones en producción (2:00 a. m., `auditor-saldos-main.yml`)** | Beneficio directo: al dejar de perderse anotaciones y al ser inmutable `auditoria`, la revisión `W4_reversiones_sin_auditoria` es más fiable. | Sin cambios requeridos en Fase 0. |
| **Pruebas automáticas (`vitest`)** | Ampliadas con 4 pruebas nuevas (`auditFase0Op109.test.js`) y verificación de `origen: 'worker'` en `audit.test.js`. | Todas las pruebas pasan en verde. |
| **Avisos programados del servidor (`wrangler.toml`)** | Sin impacto (no se modifican tareas programadas). | Sin cambios requeridos. |

---

## Verificación realizada

- **Pruebas automáticas locales (`vitest`):** `139/139` archivos (`1.320/1.320` pruebas) en verde, incluyendo `audit.test.js` y `auditFase0Op109.test.js` (guardia estática contra llamadas sueltas).
- **Compilación (`vite build` + PWA):** OK en raíz y en `construacero-staging/`.
- **Despliegue en staging:**
  - Base de datos `spupqgkdsgohxxfoxydl`: migración `329_staging_auditoria_inmutable_fase0.sql` aplicada (política `auditoria_jefe_all` reemplazada por `auditoria_jefe_select` y disparador `trg_auditoria_inmutable` activo).
  - Worker `construacero-staging` desplegado en `https://construacero-staging.luigistorelogistics.workers.dev` (versión `ac27f904-4c13-4ce2-8345-fdb3a494a0f5`, con secreto `SUPABASE_SERVICE_KEY` cargado).
- **Pruebas en vivo contra staging (`11/11` PASS, 0 filas residuales):**
  1. `/api/ping` → `200 OK` apuntando a `spupqgkdsgohxxfoxydl`.
  2. Inicio de sesión con PIN incorrecto → `401` y **`LOGIN_FALLIDO` guardado en `auditoria`** vía `waitUntil`.
  3. Inicio de sesión con PIN válido (`administracion`) → `200` y **`LOGIN_EXITOSO` guardado en `auditoria`** vía `waitUntil`.
  4. `GET /api/admin/audit` y `GET /api/admin/audit/stats` como `administracion` → `200 OK` (antes daba `403`).
  5. Candado en base de datos bloqueó `UPDATE` y `DELETE` sobre `auditoria` con error `AUDITORIA_INMUTABLE` (`42501`).
  6. Limpieza controlada con `SET LOCAL app.permitir_limpieza_auditoria = '1'` eliminó las 2 filas sintéticas de prueba (0 basura en staging).

## Pendiente / sin verificar

- **Producción (`oyfyuszgjwcepjpngclv`) sigue intacta:** falta tu aprobación para abrir la solicitud de cambio a `main`, aplicar `319_auditoria_inmutable_fase0.sql` en producción (con respaldo previo) y publicar.
- Confirmar la próxima corrida automática del **Probador nocturno en staging (1:00 a. m.)** tras la migración `329`.
