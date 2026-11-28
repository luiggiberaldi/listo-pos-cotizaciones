# OP-2026-111 — Paso a producción de Auditoría 2.0 (Fases 0 a 5) y verificación del Probador nocturno de staging

**Fecha:** 2026-11-28 · **Origen:** [OP-2026-066](../plans/OP-2026-066_plan-auditoria-2.md), [OP-2026-108](OP-2026-108_auditoria-plan-auditoria-2.md), [OP-2026-109](OP-2026-109_auditoria-fase-0.md) y [OP-2026-110](OP-2026-110_auditoria-2-completa-staging.md) · **Solicitud de cambio:** [#99](https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/99) (`6a6eb188`) · **Estado:** ✅ **Publicado y verificado en producción**

## En resumen

- **Auditoría 2.0 (Fases 0 a 5) ya está activa en producción** (`oyfyuszgjwcepjpngclv` + Worker de Cloudflare + Vercel), tras haber pasado todas las pruebas en staging (11/11 Fase 0, 17/17 Fases 1–5, prueba visual en navegador real para Administración y Supervisor, y velocidad ~7,6 ms/op).
- **Respaldo previo y migraciones:** se guardó instantánea previa de producción en `construacero-backups/op-111-prod-preflight-20261128.txt` y se aplicaron en orden las 4 migraciones (`319`, `320`, `321` y `322`, todas con su archivo `_rollback.sql` listo).
- **Probador nocturno de staging verificado 100 % en verde:** se disparó manualmente `Staging E2E nocturno` (`#46112939562`, 2m 46s) y pasaron los 75 pasos E2E, la auditoría de Kardex y la batería completa de pruebas y PDFs sin ningún fallo.

---

## Evidencia de publicación en producción

| Verificación | Resultado |
|---|---|
| **Pre-vuelo y respaldo previo (`oyfyuszgjwcepjpngclv`)** | OK · `26.597` filas en `auditoria`, `pgcrypto` activo, `17/17` tablas clave presentes (`construacero-backups/op-111-prod-preflight-20261128.txt`). |
| **Migraciones aplicadas en producción** | `319_auditoria_inmutable_fase0.sql`, `320_auditoria_camaras_fase1.sql`, `321_auditoria_portero_catalogo_fase2.sql`, `322_auditoria_sello_resumen_archivo_fase5.sql` → todas HTTP `201`. |
| **Verificación de base de producción (solo lectura)** | `17/17` cámaras (`trg_auditoria_camara`), `59` acciones en `auditoria_catalogo`, `0` políticas `auditoria_jefe_all`, `verificar_cadena_auditoria()` = `ok: true`, `obtener_resumen_auditoria()` = `26.597` filas exactas. |
| **Solicitud de cambio** | [#99](https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/99) unida a `main` (`6a6eb188`). |
| **Despliegue Worker de producción** | GitHub Actions `#46112936468` → **success (49 s)**. |
| **Rutas en vivo en producción (solo lectura)** | `/api/ping` → `200` (`oyfyuszgjwcepjpngclv`); `/api/admin/audit/cambios`, `/peticiones` y `/verificar-cadena` → `401` sin sesión (activas y protegidas). |
| **Probador nocturno completo en staging** | GitHub Actions `#46112939562` → **success (2m 46s)** (75 pasos E2E + Kardex + batería completa `vitest`/PDFs). |

---

## Impacto en probadores e inspectores automáticos (regla OP-2026-105)

- **Probador nocturno en staging (1:00 a. m., `staging-e2e-nightly.yml`):** ejecutado y verificado **100 % verde** (`#46112939562`) con todas las migraciones y el código de Auditoría 2.0 activos.
- **Auditor de saldos y comisiones en producción (2:00 a. m., `auditor-saldos-main.yml`):** ya incluye el chequeo `W5_despachos_sin_auditoria` (solo lectura).
- **Verificador diario en staging (12:00 a. m. L–S, `verificador-diario-staging.yml`):** sin impacto negativo.
- **Pruebas automáticas (`vitest`):** `140/140` archivos (`1.324/1.324` pruebas) en verde, incluyendo guardias automáticas de cobertura (`auditFase0Op109.test.js` y `auditoriaCoberturaOp110.test.js`).

## Pendiente / sin verificar

- Revisar visualmente en producción la pestaña **Auditoría** con un usuario real de Administración/Jefe y Supervisor tras recargar la app.
- Decidir más adelante si mantener el plazo de **2 años** antes de ejecutar por primera vez el archivo histórico (`archivar_auditoria_antigua(730)`).
