# Runbook — Promoción de releases SQL a producción

> Un "release" es un paquete SQL promovido (con preflight, rollback y postflight), distinto de una migración incremental. Estructura de referencia: `supabase/release/main/07_comision_split_designado_v3_review.sql` y su `07_comision_split_designado_v3_rollback_review.sql`.

## Checklist de promoción

### 1. Origen y empaquetado

- [ ] El release proviene de migraciones/validaciones ya probadas en **staging** (no de hotfixes en vivo sin migración).
- [ ] Incluye: preflight, statements idempotentes, **rollback por objeto** y postflight.
- [ ] Si redefine funciones: auditar la **cadena completa** de redefiniciones para no pisar fixes de migraciones previas (lección 262→263; en staging existe `scripts/audit-function-chains.mjs` como patrón).
- [ ] Las firmas de funciones se preservan (call-sites del Worker dependen de ellas); si cambia la firma, hay migración de delegador/compatibilidad.

### 2. Validación en staging

- [ ] E2E completo 123/123 (×2 pasadas si es financiero/comisiones).
- [ ] Paridad verificada donde aplique (patrón `scripts/verify-parity-238b.mjs`).
- [ ] El release se ejecutó en **dry-run transaccional** (`BEGIN…ROLLBACK`) contra staging sin errores.

### 3. Build y tests del principal

- [ ] Vitest en verde y `npm run build` OK con el código que consumirá el release.
- [ ] El frontend/Worker ya sabe manejar los objetos nuevos (o el release es retrocompatible con el código actual).

### 4. Smoke tests por rama de negocio

- [ ] **Comisiones**: crear/recalcular un despacho de prueba y verificar filas + evidencia `calculo_evidencia` (split, porcentajes, designado).
- [ ] **Devoluciones/reembolsos**: una devolución parcial y una reversión en staging quedaron cuadradas (inventario + CxC + comisiones).
- [ ] **Reportes**: reporte de ventas y de vendedores sin errores y con totales coherentes.
- [ ] **Seguridad**: rutas nuevas responden 401 sin sesión; guard de rol correcto.

### 5. Permisos / RLS / EXECUTE

- [ ] Los grants (`GRANT EXECUTE`) de las funciones nuevas/redefinidas quedan como en los releases de seguridad 06/06a.
- [ ] `SET search_path = public` presente en toda RPC `SECURITY DEFINER` nueva.
- [ ] Los triggers nuevos tienen su manejo de error esperado (ej: excepciones de guardarráil con código identificable).

### 6. Aplicación en producción

- [ ] **Backup de cuerpos vivos** de todo lo que se redefinirá, con SHA registrado en bitácora.
- [ ] Ejecutar preflight → apply → smoke → postflight (nunca saltarse el orden; ver `rollback-base-de-datos.md` para el plan si algo falla).
- [ ] Los cambios de comportamiento nuevo arrancan con **toggle OFF** y se encienden como paso operacional separado.

### 7. Verificación final por entorno

- [ ] Producción: postflight verde + smoke de negocio + cuerpo vivo comparado contra el release.
- [ ] Staging: sigue en verde (el release no debió romper la paridad; si staging diverge a propósito, actualizar `../operaciones/matriz-migraciones.md`).

### 8. Registro posterior

- [ ] `CHANGELOG.md`: entrada de release (Added/Changed/Fixed/Security + Validation + Migration/Deploy notes).
- [ ] `BITACORA.md`: sesión con fecha, objetivo, ejecución, validación y lecciones.
- [ ] `../operaciones/matriz-migraciones.md`: marcar ✅ con la evidencia de la verificación.

## Errores conocidos en promociones

- Divergencia de firmas main vs staging (pasa): extraer los bloques del release ya validado y adaptar lo específico del entorno, nunca copiar árboles completos.
- `BEGIN` anidado en el paquete: warning inofensivo; preferir eliminarlo del paquete.
- Alias en minúsculas en consultas de verificación (`pg_proc`/JSON): Postgres lowercifica alias sin comillas.
