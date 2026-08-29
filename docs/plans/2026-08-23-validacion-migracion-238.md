# Validacion local de migracion 238b

Fecha: 2026-08-23
Proyecto objetivo: principal (`oyfyuszgjwcepjpngclv`)
Dictamen: PREPARADO / NO-GO

## Objetivo revisado

Auditar el paquete que implementa la politica de comisiones generadas sin ciclo de pago y con CxC excluida del calculo automatico. El alcance incluye guardrails futuros, dry-run historico, snapshot/apply/rollback y wrapper de cutover.

## Artefactos revisados

- `supabase/release/main/238a_contract_neutral_review.sql`
- `supabase/release/main/238a_contract_neutral_rollback_review.sql`
- `supabase/release/main/238b_comisiones_guardrails_review.sql`
- `supabase/release/main/238b_historical_dry_run_readonly.sql`
- `supabase/release/main/238b_historical_apply_review.sql`
- `supabase/release/main/238b_cutover_legacy_rpc_review.sql`
- `supabase/release/main/238c_contract_audit_readonly.sql`
- `scripts/validate-238b-review-package.mjs`

La migracion ejecutable `supabase/migrations/238_excluir_cxc_comision_estado_generada.sql` no se recomienda como aplicacion directa. El paquete mantiene los archivos de release separados y los gates activos. El orden neutral es `238a` (estructura) -> `238b` (guardrails y RPC); `pagadapor` queda fuera del cálculo y del ciclo de pago nuevo; el campo legacy se conserva sin escribirlo.

El 23/08/2026 se ejecuto `238c_contract_audit_readonly.sql` contra el principal `oyfyuszgjwcepjpngclv` en una transaccion `REPEATABLE READ, READ ONLY` que termino en `ROLLBACK`. Fue SOLO una auditoria de catalogo; no se ejecuto ninguna migracion, DDL, DML, GRANT ni REVOKE remoto. Evidencia en `docs/plans/2026-08-23-auditoria-contrato-238c-readonly.md` y `tmp/preflight-238c-contract-audit-2026-08-23.json`.

## Resultado de la auditoria de contrato 238c (READ ONLY)

La auditoria 238c se ejecuto en el principal y confirmo bloqueos reales que impiden instalar 238/238b tal cual:

- `comisiones` no tiene las columnas de evidencia 238b: `detalle_extras`, `comision_cxc_excluida`, `comision_pago_excluida`, `comision_otras_exclusiones`, `fraccion_no_cxc`, `calculo_version`, `politica_comision`, `fuente_calculo` y `calculo_evidencia`; `pagadapor` sí existe como campo legacy y se conserva solo para snapshot y rollback; no participa en el cálculo nuevo.
- No existe un indice unico sobre `comisiones.despachoid`; el unico indice es `comisiones_pkey`.
- No existen las tablas `comision_238b_batches` ni `comision_238b_batch_rows`.
- Las RPC `calcularcomisiondespacho(uuid)`, `calcular_comision_despacho(uuid)` y `marcar_comision_pagada(uuid)` conservan `EXECUTE` para `anon`, `authenticated` y `service_role`.
- `comisiones` sigue con constraint `comisiones_estado_check` limitado a `pendiente`, `cta_cobrar` y `pagada`; no se observa `generada` en el constraint.

Precondiciones 238b medidas: `required_evidence_columns: false`, `required_unique_dispatch_index: false`, `legacy_contracts_present: true`, `no_duplicate_dispatch_keys: true`, `ready_for_mutating_sql: false`. Con esto el paquete NO se puede instalar ni aplicar en el principal sin preparar primero un tramo de contrato separado. `238a` ya esta preparado como SQL revisable para instalar solo estructura, sin `pagadapor`, pero aun no fue ejecutado ni compilado en disposable/staging.

## Reglas verificadas estaticamente

## Contrato neutral 238a

`238a_contract_neutral_review.sql` instala solo columnas de evidencia, tablas de batch/snapshot e indice unico por `despachoid`. No cambia estados, no actualiza historicos, no agrega `pagadapor` y no instala funciones de negocio. `238a_contract_neutral_rollback_review.sql` conserva un marcador de ownership y bloquea el rollback si detecta batches, filas de snapshot o evidencia usada.

Orden requerido: `238a` -> validacion de contrato -> `238b`.

## Reglas verificadas estaticamente

1. La porcion CxC no entra en `totalcomision`.
2. El pago mixto usa `fraccion_no_cxc`.
3. La CxC queda documentada separadamente para el ajuste manual administrativo.
4. Donacion/prestamo como metodo de pago se separan de CxC.
5. Items `es_prestamo` y `Corte` se registran como exclusiones de producto.
6. La evidencia incluye split de pagos, bases, items y metadata del calculo.
7. El dry-run usa `REPEATABLE READ, READ ONLY` y termina en `ROLLBACK`.
8. El apply exige `batch_key`, snapshot, operador autorizado y `apply_key`.
9. Las propuestas obsoletas se rechazan antes de mutar filas.
10. El rollback comprueba que la fila no haya cambiado despues del apply.
11. Las filas `manual_review` bloquean la aprobacion automatica.
12. Las funciones y tablas nuevas no se exponen a `anon` ni `authenticated`.
13. El cutover de la firma legacy permanece separado y bloqueado.
14. No se permite `DROP TABLE public.comisiones`.

## Validacion local ejecutada

### Validador del paquete

Comando:

```text
npm run validate:238b:review
```

Resultado observado:

```json
{
  "ok": true,
  "remote_execution": false,
  "files_checked": 7,
  "errors": [],
  "warnings": []
}
```

### Sintaxis del validador

```text
node --check scripts/validate-238b-review-package.mjs
```

Resultado: aprobado.

### Integridad del diff de los artefactos

```text
git diff --check -- scripts/validate-238b-review-package.mjs supabase/release/main/238b_*.sql
```

Resultado: aprobado.

### Suite y build

- `npm test`: PASS; 31 archivos y 281 pruebas aprobadas.
- `npm run build`: PASS; permanece solo el warning existente de chunks mayores a 500 kB.
- Sintaxis de `api/handlers/comisiones.js` y `src/services/pdf/comisionesGeneradasPDF.js`: aprobada.
- Las pruebas de PDF validan general/individual y detallado/resumido sin error de coordenadas, overflow ni cliente ausente.

## ESLint

- Lint focalizado del paquete: 0 errores y 112 warnings heredados de imports, variables y hooks no usados.
- `npm run lint` global: no concluyente en este checkout porque recorre artefactos generados y proyectos auxiliares fuera del paquete.

## Lo que no se puede afirmar aun

La validacion PostgreSQL disponible se realizo sobre staging `spupqgkdsgohxxfoxydl`, no sobre una base disposable independiente ni sobre el principal. En staging se verificaron `238a`, `238b`, la matriz de guardrails y el dry-run historico `READ ONLY`; por eso aun no se certifica contra el principal:

- Compatibilidad exacta del paquete con el contrato actual del principal.
- Aplicacion historica segura del residual de `$3,202.76` posterior a CxC.
- Promocion automatica de las 2 filas `manual_review`.
- Aplicacion, rollback o idempotencia historica contra el principal.
- Que el baseline del principal siga identico al staging al momento de la ventana.

El dry-run staging si verifico 703 filas, 703 despachos unicos, 701 `high_confidence`, 2 `manual_review`, 0 batches y 0 mutaciones.

## Riesgos aun abiertos

### Riesgo 1: contrato real del esquema

Las migraciones locales muestran nombres legacy como `despachoid`, `vendedorid`, `cotizacionid`, `cuentaid`, `pagadaen` y `pagadapor`, pero el principal debe confirmar el esquema actual con introspeccion read-only. Si una columna difiere, el paquete debe adaptarse antes de instalarse.

### Riesgo 2: metadata historica ausente

Las columnas de evidencia son nuevas y las filas legacy no tienen necesariamente `detalle_extras`, version o provenance confiable. Esas filas deben quedar en `manual_review` cuando no exista evidencia suficiente.

### Riesgo 3: fallback de items

Un despacho sin `notas_despacho_items` usa `cotizacion_items` como fallback. El dry-run lo marca como manual y no permite promoverlo automaticamente.

### Riesgo 4: metodo de pago ambiguo

Un JSON sin montos o con formato desconocido no debe inferir CxC ni contado. Debe quedar en revision manual; nunca se debe completar el monto por intuicion.

### Riesgo 5: diferencia de firma legacy

El wrapper `calcularcomisiondespacho(UUID)` no debe aplicarse hasta confirmar la firma, triggers y consumidores actuales, y hasta probar el Worker y los cuatro PDFs.

## Gates para staging

1. Backup o clon desechable verificable.
2. Baseline read-only con timestamp, `project_ref`, cuenta y hash.
3. Compilacion de los cuatro SQL sin retirar los archivos fuente.
4. Matriz mutable aislada de pagos, exclusiones, snapshot y rollback.
5. Smoke del Worker y frontend exactamente con el commit probado.
6. Dry-run completo con evidencia por despacho.
7. Postflight de montos y conteos.
8. Aprobacion explicita del batch y de la ventana.

## Gates para principal

- Backup fresco inmediatamente antes de cualquier cambio.
- Baseline principal repetido despues del backup.
- Secrets verificados y no expuestos.
- Commit exacto construido y probado.
- Reconciliacion aplicada por batch aprobado, nunca masiva sin snapshot.
- Rollback ensayado en staging y disponible por `rollback_key`.
- Monitoreo y criterio de abortar definidos.

## Decision

`NO-GO OPERATIVO PARA PRINCIPAL / PASS CONTROLADO EN STAGING`.

El paquete pasa la validación estática local y los guardrails/dry-run fueron probados en staging. El dry-run histórico identificó una propuesta neta de `$8,188.22` frente a `$14,415.07` legacy, con `$3,024.09` CxC y `$3,202.76` de residual pendiente. Las 2 filas `manual_review` no pueden entrar en un batch automático.

La auditoría de contrato `238c` confirmó que el principal requiere primero el contrato 238a y los guardrails 238b. No se aplicó ningún batch histórico, no se retiró `REVIEW_ONLY` de los archivos fuente y el principal no fue modificado.

## Actualización 2026-08-24

- El dry-run principal fue repetido en `READ ONLY + ROLLBACK`: `729/729` filas, `728 high_confidence`, `1 manual_review` (despacho `760` 100% CxC), sin batches creados ni mutaciones.
- El contrato histórico corregido agrega los campos de snapshot faltantes para el principal (`old_pagadapor`, `proposed_pagadapor`) y define rollback junto con registro/apply.
- La prueba mutable se ejecutó solo en staging con 4 filas y backup read-only fresco; apply y rollback restauraron exactamente el baseline.
- Evidencia: `tmp/238b-staging/238b-historical-contract-staging-v4-2026-08-24T14-26-11-333Z.json`.
- El principal permanece `NO-GO` para históricos hasta registrar un batch nuevo con la evidencia fresca y aprobarlo explícitamente.
