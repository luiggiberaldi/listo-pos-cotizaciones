# Verificación unificada del release COD — verify:cod:release

- **Fecha:** 2026-10-18T20:27:24.473Z
- **Resultado:** 🔴 **NO-GO** (3/5 gates PASS)
- **Modo:** fail-fast (se detiene en el primer rojo)
- **Commit:** ef55b45 · ⚠ árbol con cambios locales
- **Entorno:** node v24.13.0 · win32 · generado por `npm run verify:cod:release`

## Precondiciones

24/24 artefactos presentes

## Gates

| # | Gate | Descripción | Resultado | Duración | Resumen extraído |
|---|---|---|---|---|---|
| 1 | `test:cod` | Tests COD (unit + contract) | ✅ PASS | 3.5s | 45 passed (45) |
| 2 | `test:cod:browser` | Interfaz COD en Chromium | ✅ PASS | 10.7s | PASS: prueba local de interfaz COD en Chromium (http://127.0.0.1:60697/src/test-fixtures/cod-modal/); no usa Supabase. |
| 3 | `verify:cod:release-local` | Migración 14 en PostgreSQL local | ✅ PASS | 10.2s | PASS: COD principal; resumen, parcial/final, Bs/tasa snapshot, idempotencia y dos JSON independientes. |
| 4 | `test` | Suite completa | ❌ FAIL (exit 1) | 16.4s | Duration  13.76s (transform 2.23s, setup 0ms, import 6.56s, tests 8.57s, environment 7ms) |
| 5 | `build` | Build de producción | ⏭︎ no ejecutado | — | (omitido por fallo previo) |

## Huellas SHA-256 de los artefactos del release 14

```
9a7997a4f7665fefacbf2dbad8a5c25c7694884f2d611848a31df482549415b8  supabase/release/main/14_cod_preflight_readonly.sql
7c9d75f1b20c3aa447cd5cc513fe9265023b0c714ef2e797e74d5a2d89d7899a  supabase/release/main/14_cod_financial_rpcs_review.sql
08a09fa6e470f4d4bca9e7f8c6fc4818cb3da775b043caddf824e1c4a8dd943c  supabase/release/main/14_cod_postflight_readonly.sql
ceba52ffd2ef6f9529ab97ca02a55d04bf3985b2e869d1f135cc60b411e4bcec  supabase/release/main/14_cod_rollback_review.sql
ff9b7de2ddc87a4a6606f4683be629533a3804d16a1ee55c071f1e4e3dddef7b  supabase/release/main/README.md
96090e37e8d925a12e3c991dfb14ccb2d99ec11cf5e1e5a3fdd54b9aea7ceb86  docs/runbooks/cutover-cod-release-14.md
cd7aa5fa18d71bf30ca73b70f3e3dd817397042941ab7fbaa68c5ed6a35f9899  docs/runbooks/cod-release-14-review-packet.md
8cafd1234c46b05dcd2138153789d50a11c8842e4d2731bb468d11f675a2a033  docs/runbooks/rollback-base-de-datos.md
334001b9ecd48072718a238c445bd78abeb2c22b1b362606973ce3729952126c  src/components/despachos/ConciliarCodModal.jsx
469ba0efc2bd76bb01af12f60ef757a82df8be73f0fa94ff1502b1b619a857c1  api/handlers/cod.js
b9c160ff08b3fecc40526148c543c59e95e70d2d73629e5133a0496702c8e73f  src/utils/codCurrency.js
d143d72326fe1f454806b6334a483d7cb93bc2b50619c97a8f2b9bd2da4099d6  api/handlers/__tests__/cod.test.js
ccafda700096000a19acdfdc604a8033f5be2d7bd69c09a7d90bb541c2400b31  src/components/despachos/__tests__/ConciliarCodModal.test.js
e61ce1c6d6ca9a8e2d2263ebfce6cb5df1a70bdf5c557ba8c8deca2040dd91a5  src/utils/__tests__/codCurrency.test.js
3faf8679ab541f2429e87365569c85c90dc8d58d3e0bfec9ad3714ed8013da4b  scripts/lib/__tests__/codMainRelease.test.js
138d0cc6c864edb1459ba88e2cb1291c351d63f82379c6a0c48559d3d8889886  scripts/lib/__tests__/invariantes.test.js
26b0e4d3527efed08d4cb58a633a80a01880072ea558a30b087d61794e941a8e  scripts/lib/invariantes.mjs
a809c28e403d8bb895e95685c37b81e98c3c8782fb278350ebe338093abe2a15  scripts/test-cod-main-release-local.mjs
20c2410b8533a96966f24da585650b290b3a5c71dc65f6fb74986b08724cd067  scripts/test-cod-modal-browser.mjs
66eb85a655a3fa0a68f8b9fe2e4c7c8c949cd7fbe7cc5af1401c490d773b9a64  src/test-fixtures/cod-modal/authFetchMock.js
2093d44d431fdd3376bc371ade98dc1d00e05fa36474cc2cf8d553b48cbaf68e  src/test-fixtures/cod-modal/index.html
dc24978b99e5d7a587332030d26f17143f5f107d3a43f62f16040064725e78a8  src/test-fixtures/cod-modal/main.jsx
72bf1407249c86b7c198465fb20de7210773605fdfd9f88cdcffce5f67ab56d1  src/test-fixtures/cod-modal/rateHookMock.js
5a81eac866ceeb38b4b0fd0ddced9c4179cb0fd5ec0c290e72816ff432dab6d7  src/test-fixtures/cod-modal/vite.config.js
```

## Detalle de fallas

### `test` — últimas 40 líneas
```
 ✓ src/utils/__tests__/dinero.test.js (38 tests) 14ms
 ✓ src/utils/__tests__/comisionUtils.test.js (10 tests) 15ms
 ✓ src/utils/__tests__/comisionesTasa.test.js (5 tests) 11ms
 ✓ src/utils/__tests__/dashboardAccess.test.js (15 tests) 15ms
 ✓ src/utils/__tests__/transportistasAuth.test.js (5 tests) 26ms
 ✓ src/utils/__tests__/sabadoHelper.test.js (5 tests) 9ms
 ✓ src/utils/__tests__/entitySearch.test.js (8 tests) 15ms
 ✓ src/utils/__tests__/whatsapp.test.js (19 tests) 12ms
 ✓ src/utils/__tests__/estadoLabels.test.js (18 tests) 11ms
 ✓ scripts/lib/__tests__/codMainRelease.test.js (6 tests) 17ms
 ✓ src/utils/__tests__/cotizacionActions.test.js (6 tests) 7ms
 ✓ src/components/despachos/__tests__/ConciliarCodModal.test.js (8 tests) 11ms
 ✓ src/utils/__tests__/calcTotales.test.js (11 tests) 13ms
 ✓ src/utils/__tests__/despachoActions.test.js (9 tests) 9ms
 ✓ src/utils/__tests__/deepEditPermissions.test.js (1 test) 7ms
 ✓ api/lib/__tests__/entitySearch.test.js (3 tests) 31ms
 ✓ src/utils/__tests__/expandPctNominal.test.js (5 tests) 9ms
 ✓ src/utils/__tests__/codCurrency.test.js (3 tests) 9ms
 ✓ src/utils/__tests__/reporteVendedoresAccess.test.js (4 tests) 6ms
 ❯ src/utils/__tests__/scratch-fallo.test.js (1 test | 1 failed) 16ms
     × debe fallar para probar el reporte NO-GO 13ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/utils/__tests__/scratch-fallo.test.js > inyeccion temporal de fallo > debe fallar para probar el reporte NO-GO
AssertionError: expected 1 to be 2 // Object.is equality
- Expected
+ Received
- 2
+ 1
 ❯ src/utils/__tests__/scratch-fallo.test.js:3:68
      1| import { describe, expect, it } from 'vitest'
      2| describe('inyeccion temporal de fallo', () => {
      3|   it('debe fallar para probar el reporte NO-GO', () => { expect(1).toB…
       |                                                                    ^
      4| })
      5|
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 Test Files  1 failed | 38 passed (39)
      Tests  1 failed | 514 passed (515)
   Start at  16:27:51
   Duration  13.76s (transform 2.23s, setup 0ms, import 6.56s, tests 8.57s, environment 7ms)
```
