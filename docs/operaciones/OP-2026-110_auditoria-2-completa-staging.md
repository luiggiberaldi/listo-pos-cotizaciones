# OP-2026-110 — Auditoría 2.0 completa (Fases 1 a 5) aplicada y verificada en staging

**Fecha:** 2026-11-27 · **Plan:** [OP-2026-066](../plans/OP-2026-066_plan-auditoria-2.md) · **Auditoría previa:** [OP-2026-108](OP-2026-108_auditoria-plan-auditoria-2.md) · **Fase 0:** [OP-2026-109](OP-2026-109_auditoria-fase-0.md) · **Estado:** ✅ **100 % completado y verificado en vivo en staging (`17/17` PASS, ~7,6 ms/op)** · **Producción:** sin tocar todavía (lista para tu autorización de pase a producción)

## En resumen

- **Auditoría 2.0 ya está funcionando completa en staging** (`https://construacero-staging.luigistorelogistics.workers.dev` + base `spupqgkdsgohxxfoxydl`), cubriendo las **Fases 1, 2, 3, 4 y 5** además de la **Fase 0**.
- **Qué hace ahora el sistema en staging:**
  1. **Cámaras automáticas en 17 tablas clave (Fase 1):** cada creación, edición o borrado se graba solo en `auditoria_cambios` con **el antes y el después exacto**, quién lo hizo, desde dónde (`app`, `automático`, `sistema` o `fuera de la app`) y sin guardar PIN ni claves. Compatible con la restauración de respaldos de 26 tablas (`X-Audit-Skip: 1` + anotación única `RESPALDO_RESTAURADO`).
  2. **Portero en la entrada del servidor y catálogo único (Fase 2):** toda operación que cambia datos, todo intento sin permiso (`401/403`) y todo error (`500`) queda anotado en `auditoria_peticiones` en segundo plano (`waitUntil`) con un mismo número de operación (`operacion_id`) que une las 3 capas. Además todas las acciones están catalogadas en `auditoria_catalogo`.
  3. **Crece sola y se vigila sola (Fase 3):** prueba automática (`auditoriaCoberturaOp110.test.js`) que frena la publicación si falta una tabla o una acción en el catálogo; chequeo `W5_despachos_sin_auditoria` integrado en el Auditor de las 2:00 a. m.; y regla permanente en `AGENTS.md`.
  4. **Pantalla Auditoría 2.0 con separación real de roles (Fase 4):** pestañas **Bitácora**, **Cambios (Antes / Después)** y **Accesos y Errores**, alertas críticas arriba, botón **Ver historia** por registro, exportación a Excel (CSV) y verificación de sellos. Toda la lectura pasa por el servidor y se cerró la lectura directa del supervisor en la base: **el supervisor ya NO puede ver precios ni dinero**.
  5. **Sello encadenado SHA-256, carga rápida y archivo >2 años (Fase 5):** cada cambio se encadena criptográficamente con el anterior (`verificar_cadena_auditoria`), las estadísticas cargan en **1 sola consulta** (`obtener_resumen_auditoria`), y existe archivo histórico (`archivar_auditoria_antigua`) que impide archivar nada con menos de 1 año.
- **Velocidad medida en staging:** 40 ediciones (con y sin cámaras + sello SHA-256) tardaron **303 ms en total (~7,6 ms por operación incluyendo red)**, muy por debajo del límite de seguridad de **+50 ms** que fijaste.

---

## Evidencia de pruebas en vivo en staging (`17/17` PASS)

- **Worker desplegado:** `construacero-staging` versión `9cc5d73e-9a14-4093-acdc-d1732697f24d`.
- **Migraciones aplicadas en staging (`spupqgkdsgohxxfoxydl`):**
  - `329_staging_auditoria_inmutable_fase0.sql` (Fase 0)
  - `330_staging_auditoria_camaras_fase1.sql` (Fase 1)
  - `331_staging_auditoria_portero_catalogo_fase2.sql` (Fase 2)
  - `332_staging_auditoria_sello_resumen_archivo_fase5.sql` (Fase 5 + cierre RLS supervisor)
  - Todas tienen su contraparte exacta para producción (`319` a `322`) y sus archivos `_rollback.sql`.
- **Resultados verificados en vivo (0 filas residuales al cerrar):**
  1. Creación y edición real de un cliente sintético vía Worker → **Capa 1** grabó `INSERT` y `UPDATE` con `operador=Ana Rodríguez`, `origen=app`, `operacion_id` correlacionado, `antes → después` exacto (`nombre`, `telefono`) y sello SHA-256.
  2. **Capa 2 (Portero)** grabó ambas mutaciones en `auditoria_peticiones` con el mismo `operacion_id`.
  3. **Resumen rápido (`GET /api/admin/audit/stats`):** `200 OK` en 1 consulta (`total=22.198`, `hoy=86`).
  4. **Historia unificada (`GET /api/admin/audit/historia`):** `200 OK`, 2 eventos en línea de tiempo.
  5. **Verificación de sellos (`GET /api/admin/audit/verificar-cadena`):** `200 OK`, `ok: true`.
  6. **Separación real de roles (`supervisor`):** en `/cambios` devolvió `200 OK` con **0 registros de precios/dinero**; en `/peticiones` y `/verificar-cadena` devolvió **`403`** (bloqueado).
  7. **Guardia de retención:** intentar archivar con menos de 365 días fue bloqueado con `RETENCION_MINIMA`.
  8. **Velocidad:** ~7,6 ms/op (límite permitido: +50 ms).
  9. **Limpieza:** 0 filas residuales en `clientes`, `auditoria`, `auditoria_cambios` y `auditoria_peticiones`.
- **Prueba visual en navegador real (`construacero-staging`, versión `9890df81-609b-4311-9811-cc4c7d493d56`):**
  - Detectó y se corrigieron 2 fallos reales (`cf2a1a1b`): (1) la Bitácora estaba oculta tras `esDesarrollador` en `AuditoriaView.jsx` (se habilitó para todos los roles autorizados en la pestaña Bitácora), y (2) el filtro del supervisor incluía `PROVEEDOR` que no existe en el enum `categoria_auditoria` (se dejó solo con etiquetas válidas del enum).
  - **Re-verificación en navegador (100 % verde, 0 errores JS / 0 errores HTTP 500):**
    - **Ana Rodríguez (`administracion`):** `1.840` registros visibles, 3 pestañas completas (`Bitácora`, `Cambios Antes/Después`, `Accesos y Errores`), `Verificar sellos` OK, cambio limpio entre pestañas.
    - **María Fernanda González (`supervisor`):** `1.745` registros visibles (95 registros financieros/de precios ocultados por el servidor), etiqueta *"Vista operativa (sin precios ni dinero)"* visible, pestaña *Accesos y Errores* y botón *Verificar sellos* ocultos.

---

## Impacto en probadores e inspectores automáticos (regla OP-2026-105)

| Probador / Inspector | Impacto de Auditoría 2.0 (Fases 0–5) | Ajuste realizado |
|---|---|---|
| **Auditor de saldos y comisiones en producción (2:00 a. m., `auditor-saldos-main.yml`)** | Ampliado con el chequeo `W5_despachos_sin_auditoria` (avisa si un despacho de los últimos 7 días quedó sin rastro). | Integrado en `scripts/auditor-saldos-main.mjs` (solo lectura, no altera saldos ni comisiones). |
| **Probador nocturno en staging (1:00 a. m., `staging-e2e-nightly.yml`)** | Los cambios de prueba ahora pasan por las cámaras y el portero en staging (~7,6 ms/op). Las tablas `auditoria*` bloquean `DELETE` directo salvo bandera controlada. | Confirmar en la próxima corrida de la 1:00 a. m. que la limpieza de fixtures de staging siga pasando 100 % verde. |
| **Verificador diario de ventas reales en staging (12:00 a. m. L–S, `verificador-diario-staging.yml`)** | Sin impacto negativo; la latencia medida (~7,6 ms/op) es despreciable. | Ningún cambio necesario. |
| **Pruebas automáticas (`vitest`)** | Se agregaron `auditFase0Op109.test.js` y `auditoriaCoberturaOp110.test.js` (8 pruebas nuevas de guardia de cobertura, Portero y separación de roles). | `140/140` archivos en verde + `vite build` OK. |
| **Avisos programados del servidor (`wrangler.toml`)** | Los procesos nocturnos (`runCleanupCotizaciones`, `runPurgeTrackingImages`, `runAvisoCobranza`) ahora envían `X-Audit-Source: cron` para quedar etiquetados como `Automático` y no como cambio manual sospechoso. | Aplicado en `worker.js` y `construacero-staging/worker.js`. |

---

## Pendiente para pasar a producción

1. Respaldo previo de la base de datos de producción (`oyfyuszgjwcepjpngclv`).
2. Aplicar en orden las migraciones `319`, `320`, `321` y `322` en producción (con sus 4 archivos `_rollback.sql` listos).
3. Abrir y unir la solicitud de cambio a `main` para publicar Worker + Vercel y correr verificación en vivo de solo lectura.
