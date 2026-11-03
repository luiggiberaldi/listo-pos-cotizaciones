# Hallazgo: 24 tablas con permisos de tabla amplios para `anon` y `authenticated`

**Fecha:** 2026-11-02 · **Alcance:** solo lectura en producción; simulaciones en staging dentro de transacciones deshechas. No se cambió ningún permiso salvo `push_subscriptions` (migración 289, ya aplicada).

## En resumen

Al revisar `push_subscriptions` apareció que **25 de las 42 tablas** del esquema público (24 hoy, tras cerrar esa) dan al navegador (`anon` = sin sesión, `authenticated` = con sesión de cuenta) todos los permisos de tabla: leer, escribir, borrar e incluso vaciar. Es el comportamiento por defecto de Supabase para tablas nuevas.

**No es un agujero abierto hoy.** Las 22 políticas de aislamiento son *restrictivas* y las políticas por rol dependen de la sesión del operador (PIN): sin esa sesión la base responde "sin operador" y no devuelve ni cambia nada. Es una **capa de defensa que falta** (cinturón sin cinturón de seguridad): si algún día se borra o se edita mal una política, la tabla quedaría abierta. Prioridad: **media-baja**, hacerlo con calma y por etapas.

## Cómo está protegido hoy

1. **Todas las tablas públicas tienen RLS activo** (ninguna sin reglas de fila).
2. Las 22 políticas `isolation_*` son **RESTRICTIVAS** (`cuenta_id = auth.uid()`): se suman como "y además" a las demás.
3. Las políticas permisivas piden un rol de operador (`get_rol_actual()` → `current_operator_context()`, que sale de la sesión del PIN). Sin sesión de operador el rol es `sin_operador` y no coincide con ninguna.
4. Verificado en staging (se deshizo todo): con la cuenta compartida **sin** sesión de operador, `usuarios` devuelve 0 filas y no se puede cambiar rol, PIN ni comisión; sin sesión, `clientes` está bloqueado y `seguimiento_operativo` devuelve 0 filas (las políticas "abiertas" de esa tabla quedan neutralizadas por la restrictiva).

## Qué riesgo queda entonces

| Riesgo | Detalle | Gravedad |
|---|---|---|
| Defensa en profundidad | Si una política restrictiva se elimina o se escribe mal (migración futura), la tabla queda abierta porque el permiso de tabla sí existe. | Media-baja |
| `TRUNCATE` (vaciar tabla) | No lo frenan las reglas de fila. La API de Supabase no lo expone, así que solo importaría con una conexión directa con ese rol. | Baja |
| Tablas nuevas | Cada tabla nueva nace con permisos amplios (reglas por defecto de Supabase). Ya pasó con `push_subscriptions` y los lotes de precios. | Media (se repite) |
| `usuarios`: columnas sensibles | `authenticated` tiene permiso de UPDATE sobre `rol`, `pin_hash`, `pin_salt`, `comision_pct`. Hay políticas de supervisor/jefe que permiten actualizar `usuarios` desde el navegador con sesión de operador. **Por confirmar** si un supervisor podría cambiar el rol o el PIN de otro operador saltándose las validaciones del Worker (la política de supervisor limita solo el cambio de su propio rol). Esta prueba requiere una sesión de operador y no se hizo. | Media (por confirmar) |

## Las 24 tablas

**Las usa directamente el navegador (14):** `auditoria`, `buzon_sugerencias`, `clientes`, `configuracion_negocio`, `cotizacion_items`, `cotizaciones`, `despacho_descuentos`, `notas_despacho`, `notas_despacho_items`, `orden_compra_items`, `ordenes_compra`, `reasignaciones_clientes`, `transportistas`, `usuarios`.
→ A estas se les puede quitar `anon` y los permisos de `TRUNCATE`, `REFERENCES` y `TRIGGER`, pero deben conservar lo que el navegador usa con sesión.

**No las usa el navegador (10):** `cliente_prestamos`, `comision_designacion_diaria`, `comision_liberaciones`, `cuentas_por_pagar`, `pagos_transportistas`, `pagos_transportistas_despachos`, `proveedores`, `seguimiento_operativo`, `system_log_analysis`, `system_logs`.
→ A estas se les puede quitar **todo** permiso a `anon` y `authenticated` (el Worker usa `service_role`). *Antes confirmar que Realtime no las escucha y que ninguna RPC del navegador las lee con el rol del usuario.*

## Propuesta por etapas (cada una: staging → verificar → producción con autorización)

1. **Etapa A — `anon` fuera:** quitar todos los permisos de `anon` en las 24 tablas (el navegador siempre entra con sesión de cuenta). Riesgo bajo. Se prueba iniciando sesión y recorriendo las pantallas en staging.
2. **Etapa B — sin `TRUNCATE`/`REFERENCES`/`TRIGGER`** para `authenticated` en las 24 tablas. Riesgo muy bajo: la app nunca los usa.
3. **Etapa C — las 10 tablas que el navegador no usa:** quitar todo a `authenticated`.
4. **Etapa D — `usuarios`:** quitar a `authenticated` el UPDATE de las columnas `rol`, `pin_hash`, `pin_salt` (y evaluar `comision_pct`): esos cambios los hace el Worker. Antes, probar el flujo de administración de usuarios completo.
5. **Etapa E — tablas futuras:** cambiar los permisos por defecto del esquema público para que las tablas nuevas no se creen con acceso para `anon`/`authenticated`, y añadir al checklist de migraciones "REVOKE explícito".

## Antes de empezar (pendientes)

- Poder iniciar sesión en staging con PIN para recorrer las pantallas (la contraseña de prueba de staging está vencida; hay que restablecerla).
- Confirmar con una sesión de operador el punto de `usuarios` (supervisor vs. rol/PIN).
- Revisar Realtime y las funciones (`RPC`) para no cortar un acceso que sí se usa.
- Sugerencia: hacerlo junto con la revisión del asesor de seguridad de Supabase tras el upgrade a Pro.

## HALLAZGO CRÍTICO (mismo día): funciones privilegiadas ejecutables sin sesión (migración 290)

Al buscar qué más podía llamar el navegador sin sesión aparecieron **167 funciones ejecutables con la llave pública**. La gran mayoría comprueban el rol del operador por dentro y están bien. **9 no comprueban nada** y son `SECURITY DEFINER` (corren con permisos de dueño):

| Función | Qué podría hacer quien la llame sin sesión |
|---|---|
| `factory_reset_operacional(cuenta)` | **Borrar los datos operativos de una cuenta** (comisiones, cuentas por cobrar, despachos, cotizaciones, auditoría…). Hay que conocer el UUID de la cuenta (lo ve cualquiera con sesión en su navegador). |
| `purgar_logs_antiguos()` | Borrar logs de más de 90 días |
| `reiniciar_correlativos()` | Reiniciar la numeración |
| `registrar_auditoria(...)` (2 versiones) | Escribir registros falsos en la auditoría |
| `sincronizar_prestamos_despacho`, `registrar_devolucion_parcial_atomica`, `calcular_comision_despacho`, `calcularcomisiondespacho` | Disparar recálculos / devoluciones de un despacho por su ID |
| `debug_comision_mixto()` | Leer datos de comisiones |

**Comprobado (staging, llave pública, sin sesión):** `factory_reset_operacional` con un UUID inexistente no fue rechazada por permisos: empezó a ejecutarse (falló por un error interno de esa copia). Es decir, **pasaba la barrera de seguridad**. En producción las 9 aparecen ejecutables por `anon`.

**No hay evidencia de uso indebido** (no se revisaron logs de acceso de la API; Supabase Pro permite hacerlo).

**Corrección — migración 290:** `REVOKE ALL … FROM PUBLIC, anon, authenticated` y `GRANT EXECUTE … TO service_role` en esas 9. Seguro porque:
- el Worker usa `service_role`;
- las demás funciones que las llaman por dentro son `SECURITY DEFINER` (corren como dueño y no dependen de ese permiso);
- el navegador no las llama (revisado en `src/`).

**Staging (aplicada y verificada):** `factory_reset_operacional`, `purgar_logs_antiguos` y `reiniciar_correlativos` ahora devuelven 401 "permission denied" con la llave pública; `tiene_gate_configurado` (la que sí necesita el login) sigue en 200.
**Producción:** pendiente de autorización. Reversa: `290_cerrar_funciones_privilegiadas_rollback_review.sql`.

Etapas A–E de permisos de tablas: en pausa hasta cerrar esto.
