# 06 — Mapa de escrituras y plan de grants (pre-aplicación)

**Fecha:** 2026-08-21
**Objetivo:** revocar escrituras REST directas sobre stock/Kardex una vez el Worker (service_role) es la única vía de mutación.
**Estado:** preparado y mapeado; **no aplicado** (gate `REVIEW_ONLY` activo).

## Precondiciones verificadas (read-only, contra el principal)

- 20/20 funciones neutrales presentes (guardrails + wrappers + reconcile/revert).
- 6/6 tablas objetivo presentes: `productos`, `inventario_movimientos`, `despacho_devoluciones`, `despacho_devolucion_intercambios`, `cuentas_por_cobrar`, `comisiones`.
- Worker **ya desplegado** (cutover completo, version `cf973e32…`).

## Mapa de escrituras (quién escribe cada tabla hoy)

### Worker (`api/`) — vía `service_role` (NO lo rompe 06)

Todas las mutaciones críticas ya van por RPC atómicas con `supaServiceHeaders` (service_role). 06 revoca de `anon`/`authenticated`, no de `service_role`, así que el Worker queda intacto.

### Frontend (`src/`) — vía `authenticated` (esto es lo que 06 revoca)

| Tabla | Escritura directa | Ubicación | Impacto |
|---|---|---|---|
| `productos` | `.update({ imagen_url })` | `components/inventario/ProductoForm.jsx:497` | 🔴 producción |
| `productos` | `.update({ activo })` (soft delete) | `hooks/useInventario.js` → `useDesactivarProducto` | 🔴 producción |
| `inventario_movimientos` | `.delete()` (cleanup de tests) | `views/TesterFlowView.jsx` | 🟡 tester |
| `cuentas_por_cobrar` | `.delete()` (cleanup de tests) | `views/TesterFlowView.jsx` | 🟡 tester |
| `productos` | `.delete()` (cleanup de tests) | `views/TesterFlowView.jsx` | 🟡 tester |
| `despacho_devoluciones` | — (solo `.select()`) | — | ✅ seguro |
| `despacho_devolucion_intercambios` | — (solo `.select()`) | — | ✅ seguro |
| `comisiones` | — (solo `.select()`) | — | ✅ seguro |

## Conclusión

06 **tal como estaba** rompería dos flujos de producción del frontend:

1. `ProductoForm.jsx` — actualizar `imagen_url` del producto.
2. `useDesactivarProducto` — activar/desactivar producto (`activo`).

Y degradaría `TesterFlowView` (cleanup de tests, ya semi-bloqueado por RLS según su propio comentario).

## Alcance recomendado

### Aplicable ya (sin escrituras de frontend)

- `comisiones`, `despacho_devoluciones`, `despacho_devolucion_intercambios`: revocar mutaciones de `anon`/`authenticated`.

### Diferido hasta migrar (es lo que falta)

- `productos` (`imagen_url`, `activo`) → migrar esos dos writes al Worker (`actualizar_producto_con_kardex_tenant_safe` o un endpoint dedicado de imagen/activo).
- `inventario_movimientos` y `cuentas_por_cobrar` (cleanup de `TesterFlowView`) → usar RPC/Worker o un rol de tester dedicado.

## Plan de ejecución

1. Migrar `imagen_url` y `activo` al Worker (2 endpoints o reutilizar RPC existente).
2. Confirmar que `TesterFlowView` usa RPC para su cleanup.
3. Re-auditar el mapa de escrituras (0 writes directos de `authenticated` en las 6 tablas).
4. Recién ahí, retirar el gate `REVIEW_ONLY` de 06 y aplicar en ventana sin uso.
5. Post-aplicación: probar ingreso/egreso/entrega/reversión/devolución + crear/editar producto con imagen + activar/desactivar.

---

## ESTADO (2026-08-21): 06a aplicado al principal

Se aplicó `06a_security_grants_safe.sql` (subconjunto seguro) vía `scripts/apply-security-grants-main.mjs`.

**Revocado** (authenticated ya no escribe, SELECT intacto, service_role intacto):
- `inventario_movimientos`, `cuentas_por_cobrar`, `comisiones`, `despacho_devoluciones`, `despacho_devolucion_intercambios`.
- RPC legacy `confirmar/registrar/revertir/ajustar_*_atomica`.

**Diferido** (sigue con escritura authenticated, pendiente de migrar):
- `productos` (`imagen_url`, `activo`).
- RPC legacy `crear/actualizar/borrar_producto_con_kardex`.
- `tester_cleanup_cotizacion` + `.delete()` de `TesterFlowView`.

Verificación: 27/27 checks PASS, datos idénticos (445 productos / 3.715 movimientos / stock 284.317).
Rollback: `tmp/apply-security-grants-main/rollback-06a-main.sql` (o dump de esquema+ACLs pre-apply).
