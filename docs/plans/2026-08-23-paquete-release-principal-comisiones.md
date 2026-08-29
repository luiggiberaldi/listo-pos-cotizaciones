# Paquete de release principal: comisiones y PDFs

Fecha: 2026-08-23  
Proyecto: `oyfyuszgjwcepjpngclv`  
Rama: `main`  
Commits base locales saneados sobre `origin/main`: `6b4beb9` (guardrails/Worker) y `f3c4ac8` (comisiones/CxC).  
Estado: `PREPARADO / NO-GO OPERATIVO`

## Objetivo

Preparar el paquete selectivo que lleva al proyecto principal:

- Comisión generada sin ciclo de pago dentro del sistema.
- CxC excluida de `totalcomision`.
- Pago mixto calculado únicamente sobre la porción no-CxC.
- CxC manual y descuento de carro solo en el resumen administrativo.
- PDFs general/individual, detallado/resumido con cliente, correlativo, fecha de despacho y despachos únicos.
- Exclusiones históricas de donación, préstamo, Corte y productos marcados `es_prestamo`.
- Guardrails de lectura para filas legacy sin doble prorrateo.

Este documento delimita la preparación del paquete raíz. No autoriza backup, SQL remoto, revocación de grants, despliegue ni push.

## Archivos candidatos

### API y Worker

- `api/handlers/comisiones.js`
  - Consulta tenant-safe de comisiones.
  - Fuente única para filas generadas y eventos de PDF.
  - Separación de filas netas de migración 238 frente a filas legacy.
  - Conteo de despachos únicos.
- `api/handlers/clientes.js`
  - Devolución de préstamo mediante RPC atómica e idempotency key.
  - Se incluye solo si el preflight del principal confirma la RPC y sus columnas; de lo contrario queda en un paquete separado de devoluciones/Kardex.
- `worker.js`
  - Debe viajar con el mismo commit del frontend si se confirma que el diff desplegado corresponde al código validado.
- `wrangler.toml`
  - Ya no contiene tokens ni códigos literales.
  - Solo conserva `SUPABASE_URL` como variable pública.
  - `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` y `DEV_SUPER_CODE` deben configurarse fuera del archivo, como bindings/secretos de Cloudflare.

### UI, hooks y reportes

- `src/views/ComisionesView.jsx`
- `src/views/ReportesView.jsx`
- `src/components/reportes/TabLiquidacion.jsx`
- `src/views/ReporteVendedoresView.jsx`
- `src/views/DashboardView.jsx`
- `src/hooks/useComisiones.js`
- `src/hooks/useDashboardMetrics.js`
- `src/hooks/useReporteVendedores.js`
- `src/hooks/useReporteVentas.js`
- `src/utils/comisionUtils.js`
- `src/utils/estadoLabels.js`
- `src/utils/format.js`
- `src/services/pdf/comisionesGeneradasPDF.js`
- `src/services/pdf/pdfShared.js`
- `src/services/pdf/reporteVendedoresPDF.js`
- `src/utils/whatsapp.js`

Estos archivos deben revisarse como una unidad porque comparten el contrato de montos, estados y presentación.

### SQL revisable

La migración original no es el paquete recomendado para aplicar directamente:

- `supabase/migrations/238_excluir_cxc_comision_estado_generada.sql` — auditada, queda `NO-GO` directo.
- `supabase/release/main/238a_contract_neutral_review.sql` — contrato estructural neutral revisable: columnas de evidencia, tablas de batch/snapshot e indice unico por despacho.
- `supabase/release/main/238a_contract_neutral_rollback_review.sql` — rollback estructural protegido por ownership y guardas de uso posterior.
- `supabase/release/main/238b_comisiones_guardrails_review.sql` — guardrails futuros y evidencia.
- `supabase/release/main/238b_historical_dry_run_readonly.sql` — dry-run `READ ONLY` por despacho.
- `supabase/release/main/238b_historical_apply_review.sql` — snapshot, apply y rollback de históricos.
- `supabase/release/main/238b_cutover_legacy_rpc_review.sql` — wrapper de cutover de la firma legacy.
- `supabase/release/main/238c_contract_audit_readonly.sql` — auditoría READ ONLY del contrato real (ejecutada contra el principal, `ROLLBACK`).
- `scripts/validate-238b-review-package.mjs` — validador local sin conexión remota.

La migración original y los SQL 238a/238b siguen sin ejecución remota. Solo se ejecutó la auditoría `238c` en `READ ONLY` con `ROLLBACK`, sin DDL/DML/grants. `238a` no agrega `pagadapor`, no cambia estados y no actualiza históricos. La auditoría confirmó que el principal no tiene las columnas de evidencia 238b; `pagadapor` sí existe como campo legacy y se conserva solo para compatibilidad, snapshot y rollback; no se usa en el cálculo nuevo. No existe índice único por `despachoid` ni las tablas de batch; las RPC legacy de comisiones siguen públicas. Detalle en `docs/plans/2026-08-23-auditoria-contrato-238c-readonly.md`. Antes de aplicar cualquier tramo en el principal se debe confirmar:

1. Firma real de `calcularcomisiondespacho`.
2. Columnas y relaciones de `comisiones`, `notas_despacho`, `notas_despacho_items`, `cotizacion_items` y `configuracion_negocio`.
3. Compatibilidad de `es_prestamo` y campos de métodos de pago.
4. Estado actual de la función, triggers y restricciones.
5. Backup y rollback aprobados.

### Evidencia y configuración de Git

- `BITACORA.md`
- `docs/plans/2026-08-23-238b-historical-dry-run-staging.md`
- `docs/plans/2026-08-22-auditoria-pdfs-comisiones.md`
- `docs/plans/2026-08-22-fix-e2e-comisiones-pago-legacy.md`
- `docs/plans/2026-08-22-quitar-pago-comisiones.md`
- `docs/plans/2026-08-23-paquete-release-principal-comisiones.md`
- `.gitignore`

Las excepciones nuevas de `.gitignore` hacen visibles únicamente las regresiones seleccionadas de comisiones/PDF y la documentación de este paquete. No habilitan todos los tests ignorados del proyecto.

## Regresiones seleccionadas

Se preparan para formar parte del paquete:

- `src/utils/__tests__/comisionUtils.test.js`
- `src/utils/__tests__/comisionesGeneradasPDF.test.js`
- `src/utils/__tests__/pdfSharedHeader.test.js`
- `src/utils/__tests__/comisionesTasa.test.js`

La configuración histórica del repositorio ignora `*.test.js` y `__tests__/`; por eso estos archivos aparecen como nuevos y requieren inclusión explícita cuando el usuario autorice el commit. No deben agregarse todos los tests del checkout sin revisión de sensibilidad y pertenencia.

## Exclusiones explícitas

No forman parte de este release principal:

- `construacero-staging/` completo.
- `nomina-construacero/` completo.
- `.freebuff/` y sus bases locales.
- `tmp/`, PDFs, logs, dumps y builds.
- `.github/workflows/staging-e2e-nightly.yml`.
- `supabase/staging/`.
- `supabase/release/staging/`.
- `docs/architecture/`, `docs/history/` y `docs/tools/` no relacionados con este paquete.
- `supabase/migrations/236_configuracion_global_choferes_20.sql` y `237_paquete_correctivo_configuracion_produccion.sql`, salvo que se abra un release separado de transportistas/configuración.
- Cualquier `.env`, `.env.secrets`, `.dev.vars`, backup o archivo con datos reales.

Los cambios excluidos no se borran ni se revierten; permanecen fuera del paquete candidato.

## Seguridad de secretos

Se detectó que el archivo anterior contenía valores literales de Supabase y un código de desarrollador. `wrangler.toml` fue sanitizado localmente. Antes de desplegar:

- Revocar/rotar la service-role que estuvo expuesta.
- Verificar la anon key y rotarla si la política interna lo exige.
- Configurar `SUPABASE_SERVICE_KEY` como secreto de Cloudflare.
- Configurar `SUPABASE_ANON_KEY` como binding protegido o secreto de Cloudflare.
- Configurar `DEV_SUPER_CODE` como secreto de Cloudflare.
- Confirmar que el frontend use únicamente `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` autorizadas para el build.
- Confirmar que ningún secreto aparezca en bundle, logs, PDF, documentación o workflow.

No se ejecutan aquí comandos `wrangler secret put` ni despliegues.

## Validaciones ejecutadas

- `npm test`: PASS; 31 archivos y 281 pruebas aprobadas.
- Pruebas focalizadas de comisiones/PDF: PASS; 17 aprobadas (`8` contrato de pagos + `9` PDF).
- `npm run build`: PASS; permanece únicamente el warning existente de chunks mayores a 500 kB.
- `node --check api/handlers/comisiones.js`: aprobado.
- `node --check src/services/pdf/comisionesGeneradasPDF.js`: aprobado.
- ESLint focalizado: 0 errores, 112 warnings de limpieza existentes en vistas/hooks.
- `npm run lint` global: no concluyente en este checkout porque recorre artefactos generados y proyectos auxiliares fuera del paquete.
- `git diff --check`: aprobado.
- `npm run validate:238b:review`: aprobado; ahora 7 archivos revisados: contrato 238a, rollback 238a, cuatro archivos 238b y auditoría 238c, con gates `REVIEW_ONLY`, dry-run y auditoría en `READ ONLY`.
- `node --check scripts/validate-238b-review-package.mjs`: aprobado.
- `node --check api/handlers/comisiones.js`: aprobado.
- `node --check src/services/pdf/comisionesGeneradasPDF.js`: aprobado.
- `node --check` del SQL 238c: aprobado por el validador; se ejecutó únicamente la auditoría contrato en `READ ONLY` con `ROLLBACK`.
- `npm test`: 31 archivos, 281 pruebas aprobadas en la última ejecución.
- `npm run build`: aprobado en la última ejecución; solo queda el warning existente de chunks grandes.
- PDFs generados localmente en cuatro formatos sin error de coordenadas, overflow ni cliente ausente en la matriz; `17/17` pruebas focalizadas PASS.
- Dry-run histórico en staging: `703/703` filas, `701` alta confianza, `2` manuales, 0 batches, 0 snapshots y 0 mutaciones; evidencia en `docs/plans/2026-08-23-238b-historical-dry-run-staging.md`.
- La diferencia legacy/propuesta es `$6,226.85`: `$3,024.09` CxC identificada y `$3,202.76` residual pendiente de conciliación; por eso no se autoriza `238b_historical_apply_review.sql`.
- El principal continúa sin migración histórica; su baseline y contrato deben repetirse inmediatamente antes de cualquier cambio.

## Gates pendientes

| Gate | Estado | Evidencia requerida |
|---|---|---|
| Paquete selectivo | Preparado | Confirmar lista anterior y hacer stage selectivo cuando se autorice |
| Tests versionados | Pendiente | Incluir explícitamente las cuatro regresiones seleccionadas |
| Backup fresco principal | Pendiente | Timestamp, hash/tamaño, ubicación segura y restauración/clone verificada |
| Baseline principal | Pendiente | Conteos y catálogo read-only de comisiones, funciones, triggers y grants |
| Migración 238/238b | `NO-GO` | Staging y dry-run PASS; falta conciliar residual, aprobar batch, repetir baseline/backup principal, postflight y rollback |
| Secrets | Bloqueante | Rotación y bindings remotos verificados |
| Worker/frontend deploy | Pendiente | Build del commit final, versión desplegada y HTTP/health |
| Smoke post-deploy | Pendiente | Lectura autenticada, cuatro PDFs y smoke mutable solo en tenant desechable; PDF local ya PASS |
| Security grants 06 | Pendiente según estado remoto | Confirmar mapa de writes, smoke válido y revocación de REST legacy |
| Aprobación de ventana | Pendiente | Responsable, hora, duración, criterio de abortar y rollback |

## Orden de salida

1. Revisar y aprobar el listado de archivos candidato.
2. Hacer stage selectivo y revisar el diff staged.
3. Ejecutar tests/build sobre exactamente el contenido staged.
4. Crear commit descriptivo, solo después de autorización explícita.
5. Tomar backup y baseline fresco del principal.
6. Configurar/rotar secretos de producción.
7. Compilar y validar primero 238a y su rollback en PostgreSQL disposable; luego validar 238b. No aplicar la 238 original directamente.
8. Ejecutar postflight de montos y auditoría.
9. Desplegar Worker y frontend desde el commit aprobado.
10. Ejecutar smoke post-deploy y verificar los cuatro PDFs.
11. Aplicar 06/security grants solo después de confirmar que todas las escrituras válidas usan Worker/RPC.
12. Monitorear y cerrar la ventana con evidencia.

## Decisión actual

`NO-GO` operativo.

El paquete de código y el SQL revisable están delimitados y validados localmente. El baseline histórico fue regenerado en el principal: `729` filas, `728 high_confidence`, `1 manual_review` y total legacy `$14,586.18`; no se aplicó ningún batch. El contrato histórico corregido y probado en staging incluye snapshot/apply/rollback compatible con los campos reales. Continúan pendientes la aprobación explícita del batch principal, su apply reversible, el cutover legacy y el cierre operativo del deploy/smoke.

### Evidencia nueva 2026-08-24

- Prueba staging contrato histórico: `docs/plans/2026-08-24-staging-238b-contract-test.md`.
- Evidencia: `tmp/238b-staging/238b-historical-contract-staging-v4-2026-08-24T14-26-11-333Z.json`.
- Dry-run principal fresco: `tmp/e2e-main/238b-historical-dry-run-main.json`.
- Decisión: no ejecutar el histórico principal mientras exista `manual_review` y no se haya aprobado el lote generado desde este baseline.
