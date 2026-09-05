# ADR-002: Seguridad — RLS, RPCs SECURITY DEFINER y ocultamiento por columnas

- Estado: Aceptado
- Fecha: fundación del esquema (migración `013_rls_enable_and_policies.sql`); endurecimientos posteriores 2026-04 (auditoría de seguridad) y 2026-08 (releases 06/06a, migración 253, trigger 265)
- Decisores: Propietario del proyecto + auditoría de seguridad documentada en bitácora
- Contexto:
  - Supabase/Postgres con acceso directo desde el frontend (anon key) y un Worker con service role para operaciones administrativas.
  - La auditoría fundacional detectó: RLS ausente en `cotizacion_items`, `transportistas`, `reasignaciones_clientes` y `usuarios`; RPCs `SECURITY DEFINER` sin `SET search_path` (riesgo de hijacking); `auditoria` sin INSERT desde funciones DEFINER (uid = NULL); necesidad de ocultar `costo_usd` y `notas_internas` por rol.
- Decisión:
  1. **RLS habilitado en todas las tablas de negocio** con políticas por operación y por rol; helper `get_rol_actual()` para evitar subqueries repetidas. Supabase con RLS opera deny-by-default y así se documenta (no existe política DEFAULT DENY explícita).
  2. **Toda RPC de negocio crítico usa `SECURITY DEFINER` con `SET search_path = public` explícito** (ej: `registrar_auditoria`, `reasignar_cliente`, `enviar_cotizacion`, `crear_version_cotizacion` y la cadena 238a/238b de comisiones).
  3. **RLS no oculta columnas**: para `costo_usd` y `notas_internas` se usan vistas por rol (ej: `v_productos_vendedor` sin la columna) en lugar de comentarios SQL.
  4. **Validación server-side en profundidad** para reglas de negocio sensibles: el endpoint de designación del split de sábados valida rol jefe y exclusión de externos, y el trigger de BD (migración 265 `staging_designado_no_externo`, incluido en release 07 del principal) lo re-ejecuta a nivel de datos. La configuración split valida tipos/rangos en el backend (bloque G8).
  5. **Grants revisados y preservados**: releases `06_security_grants_review.sql` / `06a_security_grants_safe.sql` en principal y `253_staging_service_role_grants.sql` en staging. Al redefinir funciones hay que re-verificar EXECUTE y firmas (lección 262→263).
- Consecuencias:
  - Positivas: superficie consistente deny-by-default, auditoría inmutable (tabla INSERT-only respaldada por RPC DEFINER), reglas de dinero no eludibles desde el cliente.
  - De costo: cada RPC nueva exige revisión de search_path, grants y firmas; las vistas por rol son código adicional que mantener.
- Alternativas consideradas:
  - Ocultar columnas con RLS — descartado: Postgres RLS filtra filas, no columnas.
  - Confiar la validación del designado solo al endpoint — descartada: se añadió el trigger como segunda capa.
- Referencias:
  - `BITACORA.md` — auditoría de seguridad 26/04/2026; fundación del esquema.
  - `docs/operaciones/matriz-migraciones.md` (releases 06/06a, 253, 265).
  - `docs/runbooks/promocion-release.md` (verificación de permisos/RLS/EXECUTE).
