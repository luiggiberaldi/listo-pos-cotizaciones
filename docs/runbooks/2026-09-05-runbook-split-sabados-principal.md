# Runbook — Split de comisiones de sábados (v3 "designado del día") en el PRINCIPAL

Plan base: `docs/plans/2026-09-04-plan-comision-split-designado-sabados-v3.md` (🗃️ archivado; el paquete promovido y validado vive en `supabase/release/main/07_comision_split_designado_v3_review.sql` y su rollback).
Fecha de ejecución: 2026-09-05

## Estado actual (post Fase 3)

| Componente | Estado |
|---|---|
| Release 07 SQL aplicado al principal | ✅ (`supabase/release/main/07_comision_split_designado_v3_review.sql`) |
| Toggle `comision_split_activo` | **OFF** (sin cambio de comportamiento hasta el piloto) |
| `calcularcomisiondespacho_238b` v4 (designado) | ✅ vivo, sin `requires_manual_review` (política de pagos mixtos del principal intacta) |
| `recalcularcomisiondespacho_238b` | ✅ instalada (multi-fila) — **antes no existía y los 4 call-sites del Worker fallaban en silencio** |
| `ajustar_finanzas_devolucion_atomica` | ✅ escalado multi-fila (lección 262/263) |
| Índice único | ✅ `ux_comisiones_despacho_vendedor (despachoid, vendedorid)` |
| Tabla `comision_designacion_diaria` | ✅ con trigger que rechaza externos (fix P0) |
| Worker (designación jefe-only, G8, tipo derivación) | ✅ portado a `worker.js`/`api/handlers` |
| Frontend (hooks multi-fila, PanelDesignacion P0/P1, tarjeta config, PDFs) | ✅ portado |
| Validación | E2E staging 123/123 ×2 · dry-run SQL vs Postgres real · Vitest 319/319 · build OK |
| Deploy Worker + Frontend | ✅ versión `983b7a10` (983b7a10-faa3-4e18-aab0-4751b73698d9) — smoke: ping/app 200, designación 401 sin sesión |

## REGLA v3.1 (ajuste del jefe durante el piloto, 05/09)

- **TODAS las ventas de vendedores/supervisores elegibles splittean los días configurados**, incluidas las de **cliente propio** del vendedor: la fila del dueño queda con %_dueno (1.5%) y el designado cobra su 0.5% en fila aparte. Antes solo splitteaban clientes ajenos.
- **Fix TZ**: el dow/fecha de designación se calcula en hora **America/Caracas** (el servidor vive en UTC; sin fix, ventas después de 8:00 PM VE caían en otro día).
- **Fix frontend config**: el formulario ahora envía todos los campos y el backend filtra por columnas reales — el toggle split ya persiste (antes el filtro contra el GET cacheado descartaba los campos split en silencio).
- Aplicado en vivo al principal: 238b v3.1 + TZ (backup en tmp/v3-port/backup-main-pre-tzfix/), deploy 9ff2a3d4. Despacho #2958 recalculado y verificado: dueño 1.5% + Edgar 0.5%.
- Pendiente: espejo en staging (migración 267 con regla v3.1 + TZ) cuando se retome ese entorno.

## Cómo activar el piloto (un sábado acordado)

1. **Designar** (solo el rol jefe desde la UI de Comisiones → panel "Designado del día"): elegir vendedor/supervisor NO externo para el sábado.
2. **Activar** (Configuración → tarjeta "Sábado — Vendedor designado"): encender el toggle. Server-side valida que el % designado/dueño no supere el % general.
3. Despachos creados ese sábado con vendedor ajeno al dueño del cliente → 2 filas: designado 0.5% + dueño 1.5% (configurable). Cliente propio del designado → % normal, una fila.
4. **Al cierre del día**: verificar reportes (Ventas/Vendedores/Liquidación muestran "Cliente ajeno" aparte, sin mezclar 2%/3%) y PDF.
5. **Apagar** el toggle al terminar el piloto si así se decide (la designación queda guardada para el histórico).

## Rollback

- **Escalón 1 (instantáneo, sin SQL)**: apagar el toggle. El sistema vuelve al comportamiento exacto previo.
- **Escalón 2 (borrar filas split)**: `DELETE FROM comisiones c WHERE (c.calculo_evidencia->>'split_cliente_ajeno')::boolean IS TRUE;` (solo si se quiere eliminar la evidencia).
- **Escalón 3 (reversión completa)**: `supabase/release/main/07_rollback_aplicar.sql` — restaura cuerpos previos (backup: `tmp/v3-port/backup-main-pre07/`, SHA-256 `9879c4f27b8f…` / `d4d1afc5f4a0…`), recrea el índice original, borra tabla/funciones/columnas.

## Notas de operación

- La designación es **upsert** por (cuenta, fecha): re-designar sobrescribe sin duplicar.
- La designación aplica a despachos **creados desde su registro** en adelante (no retroactivo).
- El endpoint `/api/comisiones/designacion` responde 403 a cualquier rol distinto de `jefe`; el trigger de BD rechaza además externos/jefes/inactivos con `DESIGNADO_INVALIDO`.
- En el principal **no existen usuarios externos** (verificado): la defensa de UI+endpoint es la activa; el guard del trigger quedó validado en staging (migración 265) y es byte-idéntico.
- Los pagos mixtos del principal siguen calculando como siempre (la política `requires_manual_review` de 239 NO se portó — decisión documentada del plan).
