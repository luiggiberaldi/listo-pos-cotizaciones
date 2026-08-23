# Plan de reconciliacion historica de comisiones 238b

Fecha de preparacion: 2026-08-23
Proyecto objetivo: principal (`oyfyuszgjwcepjpngclv`)
Estado: PREPARADO / NO-GO

## Alcance

Este plan cubre la transicion de las filas legacy de `public.comisiones` a la politica acordada:

- `totalcomision` solo usa la porcion no-CxC.
- En un pago mixto, solo se computan los metodos distintos de CxC.
- CxC no se suma a la comision; `Comision CxC` sigue siendo un ajuste manual administrativo.
- Donacion y prestamo como metodo de pago quedan separados como `comision_pago_excluida`.
- Productos `es_prestamo` y productos cuyo nombre inicia con `Corte` quedan separados como `comision_otras_exclusiones`.
- La salida historica propuesta queda en estado `generada`, sin reactivar el ciclo pagar/pendiente.

No incluye borrado de columnas legacy, borrado de comisiones, cambios de inventario, cambios de CxC ni revocacion de grants.

## Evidencia disponible

Los artefactos preparados anteriormente documentaron un baseline de 725 comisiones legacy, con 696 `pendiente`, 29 `cta_cobrar` y 0 `generada`. El JSON de preflight localizado en `tmp/e2e-main/` y algunos documentos intermedios quedaron incompletos durante interrupciones de sesiones; por eso esos conteos deben ser reobtenidos en el entorno disposable o staging antes de crear un batch real.

No se debe usar el numero 725 como evidencia suficiente para aplicar. El primer gate operativo es generar un baseline reproducible con timestamp, hash del archivo y `project_ref`.

## Artefactos

1. `supabase/release/main/238b_comisiones_guardrails_review.sql`
   - Define la politica futura, normalizacion de metodos, desglose de items y tablas de batch.
   - Conserva el gate `REVIEW_ONLY`.
   - No debe ejecutarse directamente.

2. `supabase/release/main/238b_historical_dry_run_readonly.sql`
   - Ejecuta una consulta `REPEATABLE READ, READ ONLY`.
   - Devuelve una fila por comision/despacho.
   - Incluye correlativo, vendedor, monto legacy, monto propuesto, split de pago, exclusiones, metadata anterior y evidencia por item.
   - Marca `manual_review`, `high_confidence` o `high_confidence_excluded_payment`.
   - Termina en `ROLLBACK` y no modifica datos.

3. `supabase/release/main/238b_historical_apply_review.sql`
   - Define registro de snapshot, aprobacion, apply atomico e idempotencia por `apply_key`.
   - Rechaza propuestas obsoletas comparando estado, montos y metadata de calculo.
   - Bloquea lotes con filas `manual_review`.
   - Conserva rollback separado.
   - Mantiene `REVIEW_ONLY`.

4. `supabase/release/main/238b_cutover_legacy_rpc_review.sql`
   - Conserva temporalmente la firma `calcularcomisiondespacho(UUID)`.
   - Solo se aplicaria despues de probar la funcion 238b y el Worker en staging.
   - Mantiene `REVIEW_ONLY`.

5. `scripts/validate-238b-review-package.mjs`
   - Validador local sin red ni credenciales.
   - Comprueba gates, modo read-only, funciones, rollback, idempotencia y ausencia de `DROP TABLE public.comisiones`.

## Orden de ejecucion futura

### Fase 0: congelar y respaldar

1. Congelar escrituras de comisiones durante la ventana.
2. Crear backup fresco del principal mediante el mecanismo aprobado.
3. Verificar que el backup corresponda al proyecto/ref correcto, fecha y hora.
4. Restaurar o clonar el backup en un entorno disposable.
5. No continuar si el restore no abre o si no coincide el conteo de tablas principales.

### Fase 1: baseline read-only

Capturar en el disposable y luego repetir en staging:

- Conteo de comisiones por `cuentaid` y `estado`.
- Suma de `totalcomision`, `comisioncabilla`, `comisionotros` y columnas legacy.
- Conteo de despachos unicos y duplicados.
- Conteo por vendedor y por correlativo.
- Conteo de despachos con snapshot en `notas_despacho_items`.
- Conteo de despachos que requieren fallback a `cotizacion_items`.
- Conteo de pagos CxC totales, mixtos, no-CxC, donacion y prestamo.
- Catalogo de funciones, triggers, constraints, indices y grants relacionados.

Guardar el resultado fuera de la BD con timestamp, hash y `project_ref`.

### Fase 2: instalar contratos en disposable

1. Copiar los cuatro SQL a una base restaurada desechable.
2. Retirar `REVIEW_ONLY` solo en memoria del runner, nunca del archivo fuente.
3. Ejecutar primero guardrails, luego apply-review.
4. Confirmar que las funciones compilan y que PostgREST recarga el schema.
5. Probar llamadas de lectura y permisos con roles `anon`, `authenticated` y `service_role`.
6. Confirmar que la instalacion no cambie filas de `public.comisiones`.

Si la version PostgreSQL del disposable no soporta alguna funcion usada por el paquete, abortar y adaptar el SQL al contrato real antes de continuar.

### Fase 3: matriz mutable aislada

Crear datos sinteticos en una cuenta disposable y probar, al menos:

| Caso | Resultado esperado |
|---|---|
| Pago 100% no-CxC | `fraccion_no_cxc = 1`; toda la comision elegible entra |
| Pago 100% CxC | `fraccion_no_cxc = 0`; `totalcomision = 0`; CxC no se convierte en comision |
| Pago mixto con montos | Solo la fraccion no-CxC escala cabilla, otros y extras |
| Pago mixto sin montos | Si no se puede inferir el split, `manual_review`; no aplicar |
| Donacion/prestamo como metodo | `comision_pago_excluida` documentada; total generado cero o excluido segun regla probada |
| Item `es_prestamo` | No entra en bases; evidencia por item explica la exclusion |
| Item `Corte` | No entra en bases; no se confunde con categoria cabilla |
| Vendedor sin comision | `manual_review` historico o no se genera futuro |
| Despacho sin snapshot | `manual_review`; no promover automaticamente |
| Vendedor distinto al dueño del cliente | `manual_review`; no aplicar |
| `montopagado`, `pagadaen` o `pagadopor` existentes | `manual_review`; no sobrescribir pagos legacy |
| Repetir `apply_key` | Respuesta idempotente, sin segunda mutacion |
| `apply_key` diferente | Error y sin mutacion |
| Cambio posterior al snapshot | Error `COMISION_APPLY_BLOQUEADO_POR_CAMBIO_POSTERIOR` |
| Rollback sin cambios posteriores | Restaura snapshot exacto |
| Rollback despues de cambio externo | Bloquea rollback y conserva evidencia |

### Fase 4: dry-run de staging

1. Crear `batch_key` nuevo y unico.
2. Ejecutar el dry-run read-only sobre todas las filas legacy de la cuenta.
3. Guardar JSON/CSV fuera de la base.
4. Clasificar cada fila por confianza.
5. Separar el lote de alta confianza de todas las filas `manual_review`.
6. Comparar sumas por vendedor, correlativo y despacho con el baseline.
7. No aplicar si el conteo de despachos unicos no coincide o si aparecen fallbacks no aprobados.

### Fase 5: snapshot y apply controlado

1. Registrar propuestas y baseline usando `registrar_propuestas_comisiones_238b`.
2. Confirmar `snapshot_rows`, `manual_review_rows` y `business_rows_mutated = false`.
3. No aprobar un batch que tenga filas manuales.
4. Aprobar el lote completo de alta confianza con responsable y hora.
5. Ejecutar `aplicar_reconciliacion_comisiones_238b` con `apply_key` nueva.
6. Verificar que cada fila aplicada conserve `batch_key`, evidencia y metadata 238b.
7. Si falla una fila, abortar toda la transaccion y no continuar parcialmente.

### Fase 6: postflight y rollback ensayado

Comparar antes/despues:

- Conteo de comisiones y despachos unicos.
- Suma de comision por vendedor.
- Suma de `comision_cxc_excluida`, `comision_pago_excluida` y `comision_otras_exclusiones`.
- `totalcomision = comisioncabilla + comisionotros + extras` por fila.
- `totalcomision` nunca incluye la porcion CxC.
- No aparecen estados de pago nuevos.
- No cambia stock, CxC, despachos ni auditoria no relacionada.

Ensayar rollback con `rollback_key` nueva. Confirmar que el segundo llamado con la misma llave sea idempotente y que una llave distinta sea rechazada.

## Gated promotion

Solo despues de que disposable y staging pasen:

1. Validar el mapa de escrituras del Worker.
2. Desplegar el commit exacto probado.
3. Ejecutar smoke autenticado de pantalla, API y cuatro PDFs.
4. Repetir baseline read-only en principal.
5. Tomar backup fresco inmediatamente antes del cambio.
6. Aplicar guardrails futuros.
7. Ejecutar un lote historico pequeño, aprobado y reversible.
8. Postflight.
9. Ampliar por batches solo si no hay diferencias.
10. Aplicar el cutover legacy al final.

## Criterios de abortar

- Backup no verificable.
- `project_ref` o `cuenta_id` incorrectos.
- Baseline no reproducible.
- Diferencia de conteo de despachos unicos.
- Cualquier fallback no clasificado como manual.
- Cualquier vendedor mismatch.
- Cualquier monto pagado legacy presente en un lote promovido.
- Error de compilacion PostgreSQL.
- Cambio de filas fuera del batch.
- Rollback que no pueda demostrar restauracion exacta.

## Estado actual

`NO-GO`.

El paquete local esta preparado y validado estaticamente. No se ha ejecutado SQL remoto, no se ha creado un batch real, no se ha aplicado ninguna correccion historica y no se ha retirado `REVIEW_ONLY` de los archivos fuente. Falta compilar y probar en PostgreSQL disposable, ejecutar matriz mutable aislada, validar staging, capturar baseline/backup fresco y obtener aprobacion de ventana.
