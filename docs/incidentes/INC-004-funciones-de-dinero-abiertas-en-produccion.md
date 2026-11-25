# INC-004 — Dos funciones de dinero abiertas a cualquiera en producción

- **Detectado:** 2026-11-25, durante la revisión de producción **solo mirando** del plan [OP-2026-084](../plans/OP-2026-084_plan-testeo-completo-inventario.md) (sección 6). Origen del hallazgo: auditoría [OP-2026-076](../operaciones/OP-2026-076_auditoria-independiente-inventario-staging.md) (C1).
- **Entorno:** **producción** (`oyfyuszgjwcepjpngclv`). No se cambió nada; solo se leyó.
- **Estado:** 🟢 **Cerrado en producción el 2026-11-25** (autorizado por el dueño en el chat: "Sí, ciérralas ya"). Caso [OP-2026-085](../operaciones/REGISTRO.md).

## En resumen

- En producción, dos funciones de la base de datos que **mueven dinero** se pueden ejecutar **sin iniciar sesión** y **no revisan quién las llama**:
  - `registrar_cargo_cxc(uuid, uuid, numeric, text, uuid)`: suma una deuda a un cliente y cambia su saldo.
  - `registrar_pago_comision(uuid, uuid, uuid)`: marca una comisión como pagada.
- Para usarlas hace falta conocer identificadores internos (del cliente, o de la comisión y la cuenta). No son fáciles de adivinar, pero un usuario con sesión, por ejemplo un vendedor, puede verlos.
- **El programa publicado no usa ninguna de las dos** (búsqueda en `origin/main`, sin resultados). Cerrarlas no afecta ninguna pantalla.
- **No se encontró señal de abuso:** de los 337 cargos de deuda en producción, 0 tienen un usuario que no exista. No es prueba definitiva (quien llame a la función puede poner cualquier usuario), pero no hay rastro anormal.

## Evidencia (consultas de solo lectura)

| Función | Sin sesión | Con sesión | Revisa quién llama |
|---|---|---|---|
| `registrar_cargo_cxc(uuid,uuid,numeric,text,uuid)` | sí | sí | **no** |
| `registrar_pago_comision(uuid,uuid,uuid)` | sí | sí | **no** |
| `registrar_cargo_cxc(uuid)`, `registrar_abono_cxc`, `reasignar_cliente`, `marcar_comision_pagada`, `reciclar_*`, `aplicar_movimiento_lote`, `actualizar_estado_despacho` | sí | sí | sí (exigen un usuario operador activo) |
| `liquidar_transportista`, `registrar_devolucion_parcial_cobro_idempotente` | no | no | — (cerradas) |

Definidas en `supabase/migrations/061_atomic_cargo_cxc.sql` y `118_rpc_registrar_pago_comision.sql`, sin quitar el permiso por defecto a `PUBLIC`.

## Otros hallazgos de la misma revisión (producción)

- **Respaldo recortado:** el servidor de datos de producción también entrega como máximo **1000 filas** por consulta. El respaldo de la app guarda solo 1000 de los 8044 movimientos de Kardex, de las 7731 líneas de cotización, de los 6798 artículos de despacho y de los 1065 movimientos de cuentas por cobrar. **Los respaldos descargados desde la app están incompletos.**
- **Reglas de lectura entre empresas (corregido el 2026-11-25):** la primera lectura de esta revisión exageró el problema, porque no tomó en cuenta las reglas de bloqueo ("restrictivas") que ya existen. Con esas reglas incluidas, casi todas las tablas están protegidas por empresa. Solo quedan abiertas a cualquier sesión, sin importar la empresa: `despacho_devoluciones` y `despacho_devolucion_intercambios` (regla "Permitir todo…" con `USING (true)`), y los registros técnicos `system_logs` y `system_log_analysis` (para supervisores). Producción tiene 2 cuentas.
- **Escritura directa a tablas (corregido el 2026-11-25):** la primera revisión dijo "ninguna", pero usó una consulta (`information_schema.role_table_grants`) que no muestra bien los permisos. Con `has_table_privilege`, cualquier sesión iniciada (`authenticated`) **sí tiene** permiso de insertar, modificar y borrar en `notas_despacho`, `notas_despacho_items`, `cliente_prestamos`, `clientes`, `cotizaciones` y `cotizacion_items`. Lo que se puede hacer de verdad depende de las reglas de acceso; en `cliente_prestamos` la regla "Permitir todo…" (`USING (true)`) lo deja abierto a cualquier sesión. Es la falla **N30**, ya registrada como abierta en producción; se corrige con el paso a producción del trabajo de inventario. En `productos`, `inventario_movimientos`, `cuentas_por_cobrar`, `comisiones`, `despacho_devoluciones` y `usuarios` no hay escritura directa.

## Arreglo propuesto (requiere autorización del dueño)

Migración de producción de una sola instrucción por función:

```sql
REVOKE ALL ON FUNCTION public.registrar_cargo_cxc(uuid,uuid,numeric,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_pago_comision(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cargo_cxc(uuid,uuid,numeric,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_pago_comision(uuid,uuid,uuid) TO service_role;
```

Vuelta atrás: volver a dar `EXECUTE` a `PUBLIC`. Riesgo: muy bajo, porque ningún código las usa.

## Arreglo aplicado (2026-11-25)

- Migración `supabase/migrations/312_cerrar_rpcs_dinero_abiertas.sql` (vuelta atrás en `312_cerrar_rpcs_dinero_abiertas_rollback.sql`), aplicada en producción tal cual, dentro de una transacción.
- **Verificación en vivo:**
  - `registrar_cargo_cxc(uuid,uuid,numeric,text,uuid)` y `registrar_pago_comision(uuid,uuid,uuid)` quedaron con `anon=false`, `authenticated=false` y `service_role=true`; permisos `{postgres=X, service_role=X}`;
  - una llamada sin sesión desde internet a `registrar_pago_comision` responde **HTTP 404**, es decir, ya no es visible;
  - la versión protegida `registrar_cargo_cxc(uuid)` no se tocó.
- Constancia en el repositorio: solicitud de cambio #83 (commit `e4500931`).
- Riesgo: ninguno conocido, porque el programa no usa esas funciones.

## Pendiente

- Revisión más fina (cruzar cada cargo y cada pago de comisión con la auditoría del sistema).
- Avisar al dueño que no confíe en los respaldos descargados desde la app hasta arreglarlos; usar los respaldos completos de la base de datos.
