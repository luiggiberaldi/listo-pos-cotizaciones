# Paquete de revisión independiente — COD release 14

**Estado: PREPARADO PARA REVISIÓN / NO-GO PARA APPLY.** Este paquete ordena el contrato y las evidencias para obtener aprobaciones; el preflight read-only de catálogo está registrado abajo, pero esto no constituye firmas independientes, respaldo restaurable, revisión completa de cuerpos/grants ni autorización de despliegue.

## Decisión solicitada

Completar una revisión independiente de contabilidad y de seguridad/DBA del cobro COD, incluido efectivo Bs. Cada revisor debe marcar un resultado por escrito y documentar excepciones. La aprobación comercial previa de usar la tasa seleccionada al confirmar no reemplaza estas revisiones técnicas.

**No incluir aquí** credenciales, tokens, project refs sensibles, dumps, recibos, nombres de clientes ni datos reales de pagos.

## Contrato que se revisa

- Métodos de pago externos permitidos: `Efectivo $`, `Efectivo Bs`, `Zelle`, `Transf. / Pago Móvil`, `Punto de Venta`, `USDT`.
- Roles de servidor habilitados: `administracion`, `jefe`, `supervisor`, `desarrollador`; el desarrollador virtual no puede firmar asientos.
- El conciliador valida tenant, despacho, actor activo, evidencia e idempotencia. En SQL la operación es atómica y la llave solo reproduce el mismo payload.
- Se mantienen por separado `forma_pago` y `forma_pago_cliente`; ambas deben tener un único COD y monto nominal coherente. Cada JSON conserva sus elementos no-COD propios. Desacuerdo o ambigüedad falla cerrado.
- Los montos USD y Bs admiten máximo 2 decimales; cada `Efectivo Bs` guarda además tasa a 8 decimales, fuente, timestamp de confirmación del servidor y equivalente USD a centavos. La regla de empate es **half-up** (coincide con `round(numeric, 2)` de PostgreSQL). Cada abono parcial conserva su snapshot; las tasas futuras no revalúan abonos anteriores.
- Se permite pagar como máximo USD 0.01 por encima de la deuda; el excedente se registra explícitamente. Cualquier saldo pendiente, incluso USD 0.01, deja el COD como parcial y no dispara el recálculo de comisión.
- La conciliación parcial no recalcula comisión; la liquidación final llama una vez a `recalcularcomisiondespacho_238b(uuid)`. Verificar la semántica del cuerpo real de release 07: el harness local usa un stub y **no** verifica el importe final de comisión.
- La tabla de idempotencia es historial financiero retenido, no se elimina en rollback. Confirmar contrato, retención, privacidad y acceso mínimo.

## Revisión contable independiente

Revisor/a: ____________________  Cargo/área: ____________________  Fecha: ____________________

Resultado (marcar uno): [ ] APROBADO  [ ] APROBADO CON CAMBIOS  [ ] RECHAZADO

- [ ] Confirmo que el efectivo en Bs se convierte con la tasa vigente seleccionada al confirmar, no con la fecha del despacho ni una tasa futura.
- [ ] Apruebo máximo dos decimales para los montos en USD/Bs y hasta ocho decimales para la tasa.
- [ ] Apruebo explícitamente redondeo `half-up` a centavos (incluye $100.005 → $100.01).
- [ ] Apruebo qué evidencia y fuente de tasa se conservan y el timestamp de confirmación del servidor.
- [ ] Apruebo abonos parciales independientes y saldo USD fijo/no revaluado tras un cambio de tasa.
- [ ] Acepto la regla de liquidación: se puede registrar como máximo USD 0.01 por encima de la deuda; el excedente queda explícito en el resultado y evidencia. Un pago que deje cualquier saldo pendiente, incluso USD 0.01, se mantiene parcial y no dispara el recálculo de comisión.
- [ ] Confirmo el momento, único llamado y efecto contable del recálculo de comisión al completar COD.

Comentarios/condiciones: ______________________________________________________________

## Revisión de seguridad / DBA independiente

Revisor/a: ____________________  Cargo/área: ____________________  Fecha: ____________________

Resultado (marcar uno): [ ] APROBADO  [ ] APROBADO CON CAMBIOS  [ ] RECHAZADO

- [ ] Verifiqué identidad/tenant del actor y despacho, allowlist de roles y rechazo del operador virtual.
- [ ] Revisé `SECURITY DEFINER`, `search_path`, propietario, grants: ejecución solo por `service_role`; no acceso directo de `anon`/`authenticated`.
- [ ] Revisé idempotencia, bloqueo concurrente, hash/payload, evidencia y retención de replays.
- [ ] Revisé atomicidad al fallar CxC, ambos JSON, auditoría o recálculo de comisión.
- [ ] Revisé origen independiente de ambos JSON y comportamientos para entradas COD duplicadas, discordantes, ausentes o JSON inválido.
- [ ] Revisé columnas reales, tipos, constraints, triggers, RLS, dependencias y compatibilidad del RPC en un disposable representativo.
- [ ] Revisé si la tabla idempotente u objetos COD ya existen; no se reemplaza ningún objeto preexistente desconocido.
- [ ] Acepto explícitamente la limitación del harness de esquema reducido y requiero ensayo adicional de comisión real.

Comentarios/condiciones: ______________________________________________________________

## Evidencia local preparada

Comandos disponibles en la copia local; no conectan a Supabase:

```bash
npm run test:cod
npm run test:cod:browser
npm run verify:cod:release-local
npm test
npm run build
```

- `test:cod`: handlers, contrato de modal, utilitario decimal y guardas SQL review-only.
- `test:cod:browser`: Chromium con mocks locales; captura payloads de dos abonos y cambio de tasa.
- `verify:cod:release-local`: PostgreSQL desechable en `127.0.0.1`, comparación de conversión JS vs PostgreSQL, pruebas de conciliación/ledger y pre/postflight. No usa `.env`, proyecto remoto, ni el cuerpo real de comisión.
- `npm test` y `npm run build` son verificaciones completas del checkout en que se ejecuten; repetir después de incorporar las firmas o de cualquier cambio.

Evidencia registrada en la preparación local del 2026-10-03: suite completa 624/624; build Vite exitoso; prueba Chromium de UI aprobada; harness PostgreSQL 17 de loopback aprobado incluyendo casos de medio centavo. El build reportó advertencias preexistentes de Browserslist desactualizado y bundles grandes. La suite no sustituye aprobación independiente ni prueba en entorno desplegado.

## Gates de avance que siguen sin completar

- [ ] Adjuntar ambas revisiones independientes anteriores y resolver comentarios.
- [ ] Congelar el alcance exacto y calcular/registrar SHA del código/Worker que se pretenda desplegar; no se verificó SHA remoto.
- [x] Preflight read-only R14 ejecutado el 2026-10-05 por Management API tras verificar que `.env` apunta al proyecto principal aprobado. Resultado: tablas requeridas presentes; `missing_columns=null`; `recalcularcomisiondespacho_238b(uuid)` presente; `resumen_financiero_despacho` y `registrar_pago_externo_cobro_idempotente` ausentes; `cod_conciliacion_idempotencia` ausente; tabla `supabase_migrations.schema_migrations` presente; PostgreSQL dispone de `pg_input_is_valid`. La llamada fue solo consulta de catálogo; no se ejecutó SQL mutante.
- [x] Metadatos de dependencia COD consultados read-only el 2026-10-05: `recalcularcomisiondespacho_238b(uuid)` es propiedad de `postgres`, `SECURITY DEFINER`, `VOLATILE`, `search_path=public`; ACL explícita/efectiva solo `postgres` y `service_role` (anon/authenticated sin EXECUTE). Se guardó únicamente un fingerprint MD5, no el cuerpo.
- [ ] DBA compara fingerprint/definición contra release 07 y firma su revisión; el fingerprint no demuestra por sí solo equivalencia funcional.
- [x] Historial: la tabla tiene columnas `version`, `statements`, `name`; filtro read-only por nombre/versión COD y `14/014/0014` no encontró filas.
- [ ] DBA revisa el historial completo y acuerda el método manual compatible con su deriva conocida; el filtro sin coincidencias no prueba ausencia de un release equivalente. No usar `supabase db push`, `db reset` ni `migration repair`.
- [ ] Obtener backup financiero restaurable y evidencia de restore en disposable; todavía no existe evidencia de ese backup.
- [ ] Ensayar el apply y rollback en disposable representativo con funciones/triggers reales aprobados, no con el stub local.
- [ ] El owner emite un paquete versionado aprobado y autorización explícita, responsable de ventana/monitor y plan de parada.
- [ ] Solo después del apply autorizado: postflight read-only y smoke aprobado, con seguimiento y registro de resultados.

### Registro de decisión de apply (solo después de superar los gates)

Owner/DBA que autoriza: ____________________  Referencia de aprobación: ____________________

SHA aprobado: ____________________  Backup/restore verificado: ____________________

Ventana/responsable de monitoreo: ____________________  Fecha: ____________________

**Hasta completar todos los gates: mantener `REVIEW_ONLY`; no aplicar SQL ni desplegar el Worker.** El GO comercial de F3 y los prechecks de F3 no sustituyen estos gates ni demuestran que las RPC de COD estén instaladas.

## Artefactos a revisar

- [Runbook de cutover COD 14](cutover-cod-release-14.md)
- [SQL de reconciliación review-only](../../supabase/release/main/14_cod_financial_rpcs_review.sql)
- [Preflight de solo lectura](../../supabase/release/main/14_cod_preflight_readonly.sql)
- [Postflight de solo lectura](../../supabase/release/main/14_cod_postflight_readonly.sql)
- [Rollback review-only](../../supabase/release/main/14_cod_rollback_review.sql)
- [Handler del Worker](../../api/handlers/cod.js)
- [Modal COD](../../src/components/despachos/ConciliarCodModal.jsx)
- [Conversión decimal exacta](../../src/utils/codCurrency.js)
- [Harness SQL local](../../scripts/test-cod-main-release-local.mjs)
- [Prueba local en Chromium](../../scripts/test-cod-modal-browser.mjs)
