# Validacion local de migracion 238b

Fecha: 2026-08-23
Proyecto objetivo: principal (`oyfyuszgjwcepjpngclv`)
Dictamen: PREPARADO / NO-GO

## Objetivo revisado

Auditar el paquete que implementa la politica de comisiones generadas sin ciclo de pago y con CxC excluida del calculo automatico. El alcance incluye guardrails futuros, dry-run historico, snapshot/apply/rollback y wrapper de cutover.

## Artefactos revisados

- `supabase/release/main/238b_comisiones_guardrails_review.sql`
- `supabase/release/main/238b_historical_dry_run_readonly.sql`
- `supabase/release/main/238b_historical_apply_review.sql`
- `supabase/release/main/238b_cutover_legacy_rpc_review.sql`
- `scripts/validate-238b-review-package.mjs`

La migracion ejecutable `supabase/migrations/238_excluir_cxc_comision_estado_generada.sql` no se recomienda como aplicacion directa. El paquete 238b mantiene los archivos de release separados y los gates activos.

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
  "files_checked": 4,
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

- `npm test`: 31 archivos, 281 pruebas aprobadas.
- `npm run build`: aprobado; permanece solo el warning existente de chunks mayores a 500 kB.
- Sintaxis de `api/handlers/comisiones.js` y `src/services/pdf/comisionesGeneradasPDF.js`: aprobada.
- Las pruebas de PDF validan general/individual y detallado/resumido sin error de coordenadas, overflow ni cliente ausente.

## ESLint

- Lint focalizado del paquete: 0 errores y 112 warnings heredados de imports, variables y hooks no usados.
- `npm run lint` global: no concluyente en este checkout porque recorre artefactos generados y proyectos auxiliares fuera del paquete.

## Lo que no se puede afirmar aun

No hay una compilacion real contra PostgreSQL disposable en esta sesion. El checkout no contiene una conexion disposable utilizable y el preflight guardado en `tmp/e2e-main/` no esta completo ni es reproducible. Por esa razon no se certifican todavia:

- Compatibilidad exacta de todas las columnas con la base principal.
- Compilacion de PL/pgSQL y disponibilidad de `pg_input_is_valid` en la version PostgreSQL destino.
- Existencia real de todos los roles usados por las funciones.
- Comportamiento real de constraints, grants, RLS y triggers.
- Conteo reproducible de las 725 filas historicas.
- Conteo real de filas de alta confianza y revision manual.
- Aplicacion, rollback o idempotencia contra datos.

## Riesgos aun abiertos

### Riesgo 1: contrato real del esquema

Las migraciones locales muestran nombres legacy como `despachoid`, `vendedorid`, `cotizacionid`, `cuentaid`, `pagadaen` y `pagadopor`, pero el principal debe confirmar el esquema actual con introspeccion read-only. Si una columna difiere, el paquete debe adaptarse antes de instalarse.

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

`NO-GO OPERATIVO`.

El paquete esta completo como propuesta revisable y pasa las validaciones estaticas locales. No esta autorizado para staging ni principal hasta obtener una base disposable, compilar el SQL en PostgreSQL real, ejecutar la matriz aislada y regenerar el baseline historico verificable.
