# Runbook — Deploy a staging

> ⚠️ **No asumir que staging y producción tienen migraciones idénticas.** Los números pueden coincidir en propósito pero no en estado: la referencia por entorno es `../operaciones/matriz-migraciones.md`. Históricamente staging llevó migraciones (257–267) que producción recibió después consolidadas como releases — siempre verificar el **cuerpo vivo** de las funciones, no solo el número de archivo.

## Objetivo de staging

- Validar cambios de BD, backend y frontend en un entorno aislado (proyecto Supabase independiente, Worker y Vercel propios, árbol `construacero-staging/`) con datos de prueba y suite E2E determinista.

## Diferencias con producción

| Aspecto | Staging | Producción |
|---|---|---|
| Árbol | `construacero-staging/` | raíz del repo |
| Supabase | proyecto propio (ref `spupqgkdsgohxxfoxydl` en CI) | proyecto principal |
| Worker local | `localhost:8789` (vite en 5174) | `luigistorelogistics.workers.dev` vía Vercel |
| Migraciones | incrementales `NNN_staging_*` | releases promovidos `supabase/release/main/` |
| Datos | fixtures de prueba (tester) | datos reales del negocio |

## Flujo de trabajo

1. Desarrollar y aplicar en staging (migraciones incrementales o paquetes con preflight/postflight).
2. Levantar el entorno local si aplica: worker en 8789 + vite en 5174.
3. Ejecutar la suite E2E completa (`scripts/test-e2e-staging.mjs` del árbol staging): **123 pasos, deben pasar todos**. Dos pasadas consecutivas cuando se toque código de comisiones/finanzas (detecta residuos de fixtures).
4. El E2E nocturno programado (`.github/workflows/staging-e2e-nightly.yml`, 05:00 UTC) valida regresión diaria.

## Cómo validar paridad con producción

- Comparar cuerpos vivos de funciones críticas entre entornos (patrón: `scripts/verify-parity-238b.mjs` — normaliza y compara byte a byte).
- Verificar que los objetos nuevos (tablas, triggers, toggles) existan en ambos o que se sepa explícitamente en cuál falta.
- Revisar `../operaciones/matriz-migraciones.md` antes de asumir cualquier estado.

## Qué hacer antes de promover a producción

- [ ] E2E 123/123 en verde (×2 si el cambio es financiero o de comisiones).
- [ ] Vitest y build del árbol principal en verde si el cambio se porta al principal.
- [ ] Release SQL empaquetado con preflight, rollback y postflight (ver `promocion-release.md`).
- [ ] Sin residuos de prueba: los fixtures del E2E se limpian solos (`cleanupFixtures`); confirmar que no quedan usuarios/despachos tester.
- [ ] Backup de cuerpos vivos de funciones que se van a redefinir en producción.

## E2E mínimo requerido

- La suite completa de staging (123 pasos). Para cambios de comisiones: los pasos split (T0–T9) con sus asserts de evidencia `split_*` deben pasar, incluida la regla v3.1 (cliente propio también splittea) y la guardia designado=dueño.

## Advertencias

- ⚠️ Los números de migración de staging NO implican el mismo estado en producción (lección 262→263: un `CREATE OR REPLACE` posterior puede pisar fixes anteriores; auditar cadenas de funciones).
- Staging se sobrescribe con backups del principal solo siguiendo el procedimiento documentado en bitácora (2026-08-21) — nunca sin backup fresco capturado antes.
