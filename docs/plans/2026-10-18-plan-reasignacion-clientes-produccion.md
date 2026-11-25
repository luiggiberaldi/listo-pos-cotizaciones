# Plan — Transferencia de clientes restringida a Administración, Jefe y Desarrollador (producción)

**Fecha:** 2026-10-18
**Estado:** LISTO PARA EJECUTAR (pendiente de autorización)
**Decisión de roles confirmada:** `administracion`, `jefe`, `desarrollador` pueden transferir/reasignar clientes. **Excluidos:** `supervisor`, `vendedor`, `vendedor_sin_comision`, `logística` y demás.

La transferencia de clientes comprende tres flujos (todos sobre `clientes.vendedor_id`):
1. Reasignación individual (`POST /api/clientes/reasignar`)
2. Reasignación masiva vendedor→vendedor (`POST /api/clientes/reasignar-bulk`)
3. Mover cliente a Personal (lo reasigna a la cuenta EMPRESA vía `handleActualizarCliente`)

---

## 1. Estado actual (auditoría 2026-10-18, evidencia por archivo/línea)

| Capa | Estado | Evidencia |
|------|--------|-----------|
| API (Worker) | ✅ **Ya implementado** | `api/handlers/clientes.js:165-168` (individual), `:527-530` (masiva), `:448-450` (Personal) — `rolesPermitidos = ['administracion','jefe','desarrollador']`, si no → 403 "Solo administración, jefe o desarrollador pueden reasignar clientes", **sin tocar la BD** |
| Auditoría de cada reasignación | ✅ | Escritura en `reasignaciones_clientes` (`:238`, `:613`) con `accion: REASIGNAR_CLIENTE` y el rol real del operador |
| UI — tarjeta | ❌ **Desalineada** | `src/components/clientes/ClienteCard.jsx:242` renderiza el botón con `(esSupervisor \|\| esAdministracion)` donde `esSupervisor = ('supervisor' \| 'jefe')` (`:52`) → **supervisor ve el botón pero el API lo rechaza (403)**, y **desarrollador no lo ve aunque sí puede** |
| UI — fila (vista lista) | ❌ **Sin gate** | `src/components/clientes/ClienteRow.jsx:165-169` renderiza "Reasignar" **sin validación de rol alguna**; `:200` repite la lista vieja `(esSupervisor \|\| esAdministracion)` |
| UI — transferencia masiva | ⚠️ Por gatear | `src/views/UsuariosView.jsx`: `ModalReasignarBulk` (`:712`) se monta en `:948` cuando `reasignando` está seteado; los disparadores que setean el estado `reasignando` no filtran por la lista nueva |
| Comentarios obsoletos | ⚠️ | `src/views/ClientesView.jsx:4` ("+ puede reasignar") y `:649` ("solo supervisor") |
| Test de contrato | ❌ **Ausente** | `api/handlers/__tests__/clientesReasignacion.test.js` no existe en este repo; sí existe en `ERP/candidato-principal` (idéntico en las 3 copias de esa carpeta, **ejecutado allí: 8/8 ✓**) |
| BD | ✅ Sin cambios | Tabla `reasignaciones_clientes` creada en `supabase/migrations/009_tabla_reasignaciones.sql` — **no se requiere migración** |
| Sin bypass | ✅ | `handleActualizarCliente` no acepta `vendedor_id` en su payload (whitelist `:393` y `:408-420`); `useClientes.js:101` lo documenta |

> La lógica del API coincide con la del candidato verificado (`listo-pos-cotizaciones`): los tests 8/8 pasan contra ese mismo código. El trabajo es **alinear la UI, portar el test y desplegar**.

## 2. Alcance de cambios (mínimo necesario)

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `src/components/clientes/ClienteCard.jsx` | Añadir `const puedeReasignar = ['administracion','jefe','desarrollador'].includes(perfil?.rol)` junto a `:52-53`; en `:242` reemplazar `(esSupervisor \|\| esAdministracion)` por `puedeReasignar` |
| 2 | `src/components/clientes/ClienteRow.jsx` | Misma constante; aplicar `puedeReasignar` en **ambos** renders (`:165` y `:200`) |
| 3 | `src/views/UsuariosView.jsx` | Gatear los disparadores de `ModalReasignarBulk` (puntos que setean `reasignando`) con la misma lista |
| 4 | `src/views/ClientesView.jsx` | Actualizar comentarios `:4` y `:649` a "Reasignar: solo administración/jefe/desarrollador" |
| 5 | `api/handlers/__tests__/clientesReasignacion.test.js` | **Portar** desde `ERP/candidato-principal/api/handlers/__tests__/clientesReasignacion.test.js`. Ajustar el `vi.mock('../../lib/auth.js')` a los exports reales del workspace (`verifyAuth` y `validateOperator` confirmados en `api/lib/auth.js`; `SUPER_ADMIN_UUID` puede no existir aquí). 8 tests: `supervisor` → 403 sin fetch a BD · `vendedor` → 403 sin fetch · `jefe` → 200 + auditoría `REASIGNAR_CLIENTE` · `desarrollador` → 200 · bulk: `supervisor` → 403 y `administracion` → 200 |

**No tocar:** `api/handlers/clientes.js` (el gate del API ya tiene exactamente la lista decidida), migraciones de BD, `api/handlers/admin.js` (solo borra registros de `reasignaciones_clientes` en limpieza — fuera de alcance).

## 3. Verificación (acceptance criteria)

1. `npx vitest run api/handlers/__tests__/clientesReasignacion.test.js` → **8/8 ✓**
2. `npm test` → suite completa verde (521 actuales + 8 nuevos = 529)
3. `npx vite build` → exit 0
4. **Smoke en producción** (después del despliegue), por rol:
   - `supervisor`: sin botón "Reasignar" (tarjeta ni fila) ni transferencia masiva; llamada directa al API → **403** con el mensaje de la restricción
   - `vendedor`: ídem
   - `administracion`, `jefe`, `desarrollador`: botón visible; reasignación exitosa; fila nueva en `reasignaciones_clientes` con `usuarioRol` correcto
   - Verificar en ambas vistas (tarjetas y lista) y en UsuariosView (masiva)

## 4. Despliegue

1. Commit de los cambios (pendiente de autorización).
2. `./deploy.sh` — build (`npm run build`) + `wrangler deploy` con secrets leídos de `.env.secrets` (nunca commiteado). Worker y frontend se despliegan juntos.
3. Postflight = smoke del punto 3.

## 5. Rollback

Gate puramente de aplicación (sin migración ni datos nuevos): revert del commit + re-desplegar con `./deploy.sh`. Sin pérdida de datos; `reasignaciones_clientes` conserva el historial.

## 6. Riesgos y notas

- **El cambio solo restringe UI** (hoy supervisor ve un botón que devuelve 403): no abre permisos nuevos. El enforcement real ya vive en el Worker.
- `desarrollador` conserva acceso — decisión confirmada por el usuario (2026-10-18).
- El Worker se protege contra clientes llamando el API directamente; el gate de UI es experiencia de usuario, no seguridad (la seguridad ya está en el API).
- Futuro opcional (fuera de este plan): defensa en profundidad en BD (RLS/trigger que impida cambiar `clientes.vendedor_id` sin pasar por el Worker).
