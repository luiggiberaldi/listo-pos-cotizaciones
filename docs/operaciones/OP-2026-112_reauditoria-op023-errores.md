# OP-2026-112 — Re-auditoría en vivo de los hallazgos de OP-2026-023 (errores y fallos)

**Fecha:** 2026-11-28 · **Entorno revisado:** producción (`oyfyuszgjwcepjpngclv`, solo lectura), Cloudflare Secrets, GitHub Actions y `main` (`0c6b9854`) · **Estado:** ✅ revisión terminada (sin cambios en código ni datos) · **Origen:** [OP-2026-023](OP-2026-023_auditoria-errores-e2e.md)

## En resumen

- De los **8 problemas principales** (3 serios + 5 medianos) detectados el 10 de noviembre en [OP-2026-023](OP-2026-023_auditoria-errores-e2e.md):
  - **2 ya están resueltos y verificados hoy:** las funciones de dinero abiertas (`2.3`, cerradas en OP-085 / INC-004) y la prueba nocturna de staging (`3.2`, arreglada en OP-104 y verificada hoy 100 % verde en `#46112939562`).
  - **2 problemas serios siguen abiertos hoy:** el **vigilante nocturno de saldos en producción sigue caído** (falló hoy mismo en `#46156349404` por llave vencida en GitHub) y los **avisos push al celular siguen sin llaves VAPID** en producción.
  - **4 problemas medianos siguen abiertos:** la deuda al aprobar un despacho todavía va en un paso separado *"no crítico"*, la comisión del despacho anulado **#1898 (\$170,64) sigue `pendiente`**, quedan **23 productos activos con stock negativo** y **95 despachos pendientes + 4 despachados** con más de 30 días sin cerrar.
- De los asuntos menores, siguen abiertos: búsquedas sin sanear en 3 archivos, `4.042` sesiones de PIN vencidas acumuladas sin limpieza, ventas rápidas sin conexión (`N40`) y registros de error del Worker sin `[observability]`.

---

## Estado punto por punto (10-nov vs 28-nov)

| Punto OP-023 | Gravedad | Estado real hoy (28-nov-2026) | Evidencia verificada |
|---|---|---|---|
| **2.1 Vigilante nocturno de saldos (`auditor-saldos-main.yml`)** | 🔴 Serio | **Sigue caído** | Corrida `#46156349404` (28-nov) falló en 15 s. Falta actualizar el secreto `MAIN_SUPABASE_ACCESS_TOKEN` en GitHub. |
| **2.2 Avisos al celular (Push / VAPID)** | 🔴 Serio | **Sigue abierto** | `wrangler secret list` solo tiene 5 secretos; faltan `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` en Cloudflare y en `deploy-worker.yml`. |
| **2.3 Funciones abiertas (`registrar_cargo_cxc`, `registrar_pago_comision`)** | 🟢 Resuelto | **Cerradas en producción** | `has_function_privilege('anon', ...)` = `false` en ambas (cerrado en OP-2026-085 / INC-004). |
| **3.1 Cargo CxC al aprobar despacho en paso aparte** | 🟠 Mediano | **Sigue abierto** | `api/handlers/despachos.js:1279-1455` mantiene `/* no crítico — no bloquear aprobación por error CxC */`. |
| **3.2 Prueba nocturna de staging** | 🟢 Resuelto | **100 % en verde** | Arreglada en OP-2026-104; verificada hoy en `#46112939562` (2m 46s, todos los pasos en verde). |
| **3.3 Comisión despacho anulado `#1898` (\$170,64)** | 🟠 Mediano | **Sigue `pendiente`** | Consulta a producción: `comisiones.estado = 'pendiente'` para despacho `#1898`. |
| **3.4 Productos activos con stock negativo** | 🟠 Mediano | **Bajó de 31 → 23** | 23 productos activos con `stock_actual < 0` en producción (pendiente conteo físico / confirmación). |
| **3.5 Despachos viejos (>30 días) sin cerrar** | 🟠 Mediano | **Subió levemente** | 95 `pendiente` (antes 94) y 4 `despachada` sin entregar (antes 3). Requiere decisión de Administración. |
| **5.1 Búsquedas con coma o paréntesis** | 🟡 Menor | **Sigue abierto** | `useMovimientosInventario.js:33`, `useDespachos.js:129` y `AuditoriaView.jsx:702` aún no usan `sanitizePostgrestSearch`. |
| **5.3 Sesiones de PIN vencidas sin limpiar** | 🟡 Menor | **Creció** | `4.061` filas totales en `operator_sessions` (`4.042` ya vencidas; el 10-nov eran `3.066`). |
| **5.4 Cola sin conexión (`sw.js`)** | 🟡 Menor / `N40` | **Sigue abierto** | Mismo caso que `N40` (ventas rápidas sin conexión sin PIN ni anti-duplicado). |
| **5.5 Logs del servidor (`wrangler.toml`)** | 🟡 Menor | **Sigue abierto** | `wrangler.toml` aún no tiene `[observability]`. |

---

## Orden recomendado para resolver lo que queda de OP-023

1. **Rápido y sin riesgo (5 minutos):** renovar `MAIN_SUPABASE_ACCESS_TOKEN` en GitHub (`2.1`) para revivir el vigilante nocturno de saldos, activar las llaves **VAPID** en producción (`2.2`) y activar `[observability]` en `wrangler.toml` (`5.5`).
2. **Rápido en código (riesgo bajo):** sanear las 3 búsquedas con `sanitizePostgrestSearch` (`5.1`) y agregar limpieza nocturna de `operator_sessions` vencidas (`5.3`).
3. **Con confirmación de Administración:** revisar y anular la comisión del despacho `#1898` (\$170,64, `3.3`) y decidir sobre los 95 despachos pendientes viejos (`3.5`) y los 23 productos en negativo (`3.4`).
4. **Cambio de fondo (staging primero):** mover el cargo CxC al aprobar despacho (`3.1`) dentro de la misma operación atómica.
