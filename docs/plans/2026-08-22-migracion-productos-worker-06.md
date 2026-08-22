# Migración de productos con Kardex al Worker — preparación de 06

**Fecha:** 2026-08-22  
**Entorno:** código local; principal no mutado por esta tarea.  
**Estado:** migración implementada y probada; deploy y aplicación de `06` quedan como gates separados.

## Objetivo

Eliminar del frontend las llamadas directas a las RPC legacy:

- `crear_producto_con_kardex`
- `actualizar_producto_con_kardex`
- `borrar_producto_con_kardex`

Esto permite que `06_security_grants_review.sql` revoque el `EXECUTE` de esas RPC para `authenticated` sin romper el flujo de inventario.

## Nuevo contrato Worker

| Operación | Método/ruta | RPC usada por el Worker |
|---|---|---|
| Crear | `POST /api/productos/crear` | `crear_producto_con_kardex_tenant_safe` |
| Actualizar | `PATCH /api/productos/actualizar` | `actualizar_producto_con_kardex_tenant_safe` |
| Borrar | `DELETE /api/productos/borrar` | `borrar_producto_con_kardex_tenant_safe` |

El Worker obtiene `cuenta_id` y `usuario_id` del operador autenticado; nunca acepta esos valores desde el cliente. Las RPC se invocan con `service_role`, validan tenant/rol y registran `idempotency_key`, provenance y movimiento Kardex dentro de la transacción SQL.

## Idempotencia y seguridad

- El frontend genera una UUID por mutación y la envía en el body como `idempotencyKey` y en el header `Idempotency-Key`.
- El Worker valida que la clave sea UUID y la reenvía como `p_idempotency_key`.
- El CORS ahora permite `Idempotency-Key` para el frontend servido desde otro origen.
- Crear/actualizar permite los roles aceptados por la RPC tenant-safe: supervisor, administración, jefe y desarrollador.
- Borrar permite administración, jefe y desarrollador, y el Worker fija la confirmación `BORRAR_PRODUCTO`.
- La auditoría del Worker es best-effort; la transacción principal depende de la RPC tenant-safe.

## Consumidores migrados

- `src/hooks/useInventario.js`: las tres mutations usan `authFetch` contra el Worker.
- `src/views/TesterFlowView.jsx`: creación y limpieza de los productos de prueba usan el Worker; se eliminaron los fallbacks de `.delete()` directo para productos.
- No quedan en `src/` llamadas directas a esas tres RPC legacy ni escrituras directas sobre `productos`.

## Validación realizada

- Pruebas nuevas del handler: payload completo, tenant derivado del operador, roles, confirmación de borrado e idempotencia.
- Contrato estático: frontend usa rutas Worker y handler usa las tres RPC tenant-safe.
- `npm test`: **255/255 PASS** (26 archivos).
- ESLint focalizado: **0 errores**; solo warnings heredados del código existente.
- `node --check` para `api/handlers/inventario.js` y `worker.js`: PASS.
- `git diff --check`: PASS.
- No se ejecutaron RPC mutables ni se escribieron datos remotos.

## Gates antes de aplicar 06 completo

1. Desplegar esta versión del Worker/frontend.
2. Ejecutar smoke controlado con un producto de prueba del tenant: crear, editar stock/metadatos y eliminar; confirmar Kardex, provenance, auditoría e idempotencia.
3. Verificar nuevamente que `src/` no contenga DML directo de `productos` ni llamadas a las RPC legacy.
4. Capturar backup nativo de Supabase y/o `pg_dump` fresco antes del cambio de grants.
5. Revisar el preflight de `06_security_grants_review.sql` y retirar `REVIEW_ONLY` solo con aprobación explícita.
6. Aplicar 06 en una ventana aprobada y ejecutar postflight de grants y smoke funcional.

## Fuera de esta migración

- Las escrituras directas restantes del cleanup de `TesterFlowView` sobre tablas ya cubiertas por `06a` deben seguir migrándose a su RPC de limpieza tenant-safe.
- Los writes directos de precios/embeddings son P2 y siguen separados.
- Esta tarea no desplegó código ni aplicó `06` remotamente.
