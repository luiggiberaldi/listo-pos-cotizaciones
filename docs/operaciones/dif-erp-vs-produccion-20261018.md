# Diferencias ERP → Producción (2026-10-18)

Comparación árbol a árbol con SHA-256 entre la fuente **ERP** (`C:\Users\luigg\Desktop\sistemas personalizados\construacero\ERP\listo-pos-cotizaciones`) y **producción** (`C:\Users\luigg\Desktop\construacero`, commit `c38d775`). Excluye tooling transitorio (`.wrangler/tmp`, `tmp/`, `scratch/`, `outputs/`, `.freebuff`, `.vercel`, `.claude`, binarios). El ERP es **solo lectura**; nada se modificó allí.

## 1. Commits del ERP que producción NO tiene (ramas divergentes desde `80ae891`)

| Commit ERP | Contenido | Estado en producción |
|---|---|---|
| `980129c` feat(reportes): improve Crédito/CxC report navigation | `src/views/ReportesView.jsx` (539±), `src/components/reportes/DateRangeSelector.jsx` (+39) | **FALTA — feature completa** |
| `b539e0d` arneses locales de COD F3 y R14 + normaliza EOL | `.gitattributes`, `construacero-staging/scripts/test-f3-comision-local-integration.mjs` (565), `scripts/test-cod-main-release-local.mjs` (455) | FALTA el harness F3 `test-f3-comision-local-integration.mjs` (el harness COD ya se copió en Tarea 0). `.gitattributes` **ya existe en producción** (trackeado desde el 11-oct; solo difiere en finales de línea) — no es una brecha |

En sentido contrario, producción tiene `ef55b45` (paginación de clientes >1000) y `c38d775` (release 14) que el ERP no tiene.

## 2. Releases SQL enteros solo en ERP (sin promover)

- **Release 15 (F3 — comisión neta bucket):** `supabase/release/main/15_f3_preflight_readonly.sql`, `15_f3_capture_readonly.sql`, `15_f3_forward_review.sql`, `15_f3_postflight_readonly.sql`, `15_f3_rollback_review.sql` + baseline `.wrangler/f3-main-baseline/` (capturas de catálogo/dependencias con manifiestos SHA) + `scripts/test-f3-comision-local-integration.mjs`.
- **Release 16 (delegador):** `supabase/release/main/16_delegador_revoke_public_review.sql` + `16_delegador_revoke_public_rollback_review.sql` (revocar `PUBLIC` sobre el delegador `recalcularcomisiondespacho_238b`).
- **Migraciones staging 277–282** (en `construacero-staging/supabase/migrations/`): regularizar COD efectivo atómico, `resumen_financiero_despacho`, `conciliar_cod_con_evidencia`, fix COD parcial sin compensación, F3 comisión neta bucket, fix centavo excedente (cada una con su `rollback`).

## 3. Runbooks y planes solo en ERP

- **Runbooks (9):** `paquete-release-f3-main.md`, `ventana-apply-f3-main.md`, `validacion-f3-staging.md`, `paquete-revision-contable-f3.md`, `conciliacion-comparador-f3-general.md`, `paquete-firmas-r14-main.md`, `guia-dia-del-cambio.md`, `preparacion-implementacion-principal.md`, `analisis-delegador-public.md`.
- **Planes/docs (~45):** todo `docs/history/` (24 informes ago–sep), ~15 planes de `docs/plans/` ago–sep (238a/238b/239, kardex, P0 finanzas, releases 07–13, `2026-09-24-plan-mitigacion-fases-f0-f4.md`, `2026-09-25-roadmap-f3-f4-ejecucion.md`, `2026-09-27-roadmap-f0-f4.md`, `2026-09-30-plan-fix-cxc-cod.md`…), nómina (`PLAN_NOMINA.md`, `PLAN_PERSONAL_NOMINA.md`, `docs/requirements/nomina-matriz-cumplimiento.md`), `docs/operations/nomina-release-checklist.md`.

## 4. Tests y harness solo en ERP

- `api/handlers/__tests__/` (7): `_harness`, `clientesPrestamoAtomic`, `clientesReasignacion`, `despachosAtomic`, `inventarioAtomic`, `origenMutaciones`, `transportistasAtomic`.
- `api/lib/__tests__/` (2): `isSameOriginRequest`, `transportistaUtils`.
- `src/utils/__tests__/` (10): `adminClientAuth`, `cxcPeriodReport`, `devolucionReembolso`, `pdfCodigosDeterminista`, `reporteDescuentos`, `smartSearchStrict`, `testerClientContract`, `testerDispatchContract`, `transportistaColors`, `transportistaSchema`.
- `scripts/lib/__tests__/` (3): `codMigration`, `comisionNetaBucketMigration`, `resumenFinancieroMigration`.
- `src/utils/cxcPeriodReport.js` (+ su test) y `scripts/fixtures/cod-modal/` (5 archivos).
- Staging: `validate-cod-reconciliation-rejections-staging.mjs`, `validate-cod-reconciliation-staging-live.mjs`, `validate-cod-summary-staging-live.mjs`, `guardas-invariantes-readonly.mjs` y ~60 scripts de apply/audit/dry-run históricos (`apply-238a/238b/239/265/267/268`, `apply-release07…13`, `audit-*`, `verify-*`).

## 5. Contenido DIFERENTE (23 archivos) — divergencia bidireccional, revisar archivo por archivo

`api/handlers/cod.js` · `api/handlers/cxc.js` · `src/hooks/useCuentasCobrar.js` · `src/hooks/useClientes.js` · `src/hooks/useDespachos.js` · `src/services/pdf/cxcPDF.js` · `src/views/{ClientesView,PersonalView,ReportesView,TesterFlowView,UsuariosView}.jsx` · `src/components/clientes/{ClienteCard,ClienteRow,ReasignacionModal}.jsx` · `src/components/despachos/{DespachoCard,EditDespachoModal}.jsx` · `src/components/reportes/DateRangeSelector.jsx` · `package.json` · `.gitignore` · `.github/workflows/deploy-worker.yml` · (staging: `test-cod-sin-abono-staging.mjs`, `.gitignore`, `.dev.vars.example`).

Notas de dirección:
- **Producción adelante** en `cod.js`/`cxc.js`/`useCuentasCobrar.js`: el guard de `Idempotency-Key` obligatoria y el anti-replay de `/api/cxc/abono` del release 14 (el ERP tiene su propia variante sin trackear de `cod.js` — **no promover a ciegas**).
- **ERP adelante** en `ReportesView.jsx`/`DateRangeSelector.jsx` (commit `980129c`).
- Resto (clientes, despachos, inventario, proveedores, transportistas, vistas, `cxcPDF.js`, `package.json`, workflows): trabajo sin commit en el worktree del ERP (+46/−18 `clientes.js`, +81/−10 `despachos.js`, +76/−366 `useCuentasCobrar.js`, +76/−144 `cxcPDF.js`, +50/−26 `EditDespachoModal.jsx`…) — **requiere revisión de cada diff** para decidir promoción.

## 6. Solo en producción (contraste)

Release 14 completo (`14_cod_financial_rpcs_apply.sql`, smoke `scripts/smoke-cod-prod-14.mjs`, `test-cod-rollback-local.mjs`, `test-cod.mjs`, `verify-cod-release.mjs`, `verify-logical-backup.mjs`, `backup-supabase-logical.mjs`), plan corregido + original, 8 evidencias `verify-cod-release-*`, `cobrosIdempotencia.test.js`, `ef55b45` (paginación clientes).

## 7. Ruido NO promovible

- `.wrangler/tmp|state` (bundles/dev), `scratch/` (auditorías sueltas), `outputs/` (QA de navegador), `tmp/` (~150 scripts históricos), dumps `.dump`, 344 PDFs de factura en raíz, `.freebuff/*.db`.
- **298 archivos difieren solo en finales de línea** (normalización CRLF→LF del commit `b539e0d`) — sin cambio funcional.

## 8. ⚠️ Hallazgos de seguridad

- `.github/SECRETS_PRODUCCION_COPIAR_PEGAR.md` existe **solo en ERP** — archivo de secretos de producción en texto. No promover; rotar cualquier credencial que contenga y sacarlo del árbol.
- `construacero-staging/.dev.vars` (secretos de staging) solo en ERP — igual criterio.
