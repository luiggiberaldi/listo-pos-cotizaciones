# INC-004 — Dos funciones de dinero abiertas a cualquiera en producción

- **Detectado:** 2026-11-25, durante la revisión de producción **solo mirando** del plan [OP-2026-084](../plans/OP-2026-084_plan-testeo-completo-inventario.md) (sección 6). Origen del hallazgo: auditoría [OP-2026-076](../operaciones/OP-2026-076_auditoria-independiente-inventario-staging.md) (C1).
- **Entorno:** **producción** (`oyfyuszgjwcepjpngclv`). No se cambió nada; solo se leyó.
- **Estado:** 🔴 **Abierto**, a la espera de la autorización del dueño para el arreglo en producción.

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
- **Reglas de lectura sin filtro de empresa** en productos, Kardex, despachos, cotizaciones, clientes, cuentas por cobrar y préstamos. Producción tiene 2 cuentas; hay que confirmar si la segunda es real o de prueba para medir el impacto.
- **Escritura directa a tablas:** ninguna (correcto).

## Arreglo propuesto (requiere autorización del dueño)

Migración de producción de una sola instrucción por función:

```sql
REVOKE ALL ON FUNCTION public.registrar_cargo_cxc(uuid,uuid,numeric,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_pago_comision(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cargo_cxc(uuid,uuid,numeric,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_pago_comision(uuid,uuid,uuid) TO service_role;
```

Vuelta atrás: volver a dar `EXECUTE` a `PUBLIC`. Riesgo: muy bajo, porque ningún código las usa.

## Pendiente

- Autorización del dueño para aplicar el arreglo en producción.
- Revisión más fina (cruzar cada cargo y cada pago de comisión con la auditoría del sistema).
- Avisar al dueño que no confíe en los respaldos descargados desde la app hasta arreglarlos; usar los respaldos completos de la base de datos.
