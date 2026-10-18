# Runbook — Cutover del release COD 14 (principal)

**Estado: PREPARACIÓN / NO-GO.** Este runbook documenta un proceso futuro; no autoriza ejecutar SQL en staging o producción. El paquete SQL conserva `REVIEW_ONLY`; el preflight read-only de catálogo del 2026-10-05 confirmó que las dos RPC COD y la tabla de idempotencia no están instaladas. Aún no se ha verificado el contrato vivo completo (cuerpos/grants de dependencias), el SHA desplegado ni el historial Supabase del principal, que tiene deriva conocida.

## Alcance

- RPC de consulta `resumen_financiero_despacho(cuenta_id, despacho_id)` y conciliación atómica `registrar_pago_externo_cobro_idempotente(...)` que consume el Worker principal.
- La conciliación debe calcular y persistir `forma_pago` y `forma_pago_cliente` cada uno desde su propia fuente, sin pisar entradas de pago no-COD. COD ausente/duplicado, JSON inválido o monto nominal distinto: rechazo sin cambios.
- Para cada pago `Efectivo Bs`, capturar el monto recibido en Bs y la tasa efectiva seleccionada al confirmar; la RPC recalcula y valida el equivalente USD, fija tasa/fuente/fecha en el snapshot del abono y en evidencia. Los pagos parciales conservan snapshots independientes; cambios futuros de tasa no revalúan los anteriores. Los montos Bs y USD admiten máximo dos decimales. Se permite registrar hasta USD 0.01 de exceso, que queda informado explícitamente; cualquier saldo pendiente (incluido USD 0.01) mantiene estado parcial y no recalcula comisión.
- La corrección de regularización de efectivo 277 (`regularizar_cod_efectivo_atomico_staging`), el guard de CxC staging y su endpoint **no están incluidos ni autorizados** para principal. Son un flujo distinto y requieren release, aprobación y evidencia propios; esa RPC es exclusiva de staging.
- Este cutover no cubre F3/281 ni la promoción de otros cambios de reporte/UI/Worker.

## Bloqueo de historial

No usar `supabase db push`, `supabase db reset`, `supabase migration repair`, ni comandos de apply automáticos. La historia de migraciones del principal no coincide con la forma en que se ha gestionado el esquema. Determinar primero con el DBA/owner un método de aplicación manual que sea auditable y compatible con ese historial. No inferir que un archivo bajo `release/main` está aplicado ni que su ausencia demuestra que una RPC no exista en el entorno vivo.

## Fases y gates

### 0. Aprobación y freeze del cambio

- [x] Responsable de negocio aprobó el tratamiento contable de efectivo Bs: usar la tasa seleccionada al confirmar, convertir Bs a USD y persistir un snapshot fijo por abono (monto Bs, tasa, fuente, equivalente y fecha).
- [ ] [Paquete de revisión COD 14](cod-release-14-review-packet.md) contiene y registra revisiones independientes contable y de seguridad/DBA, incluidas regla half-up, precisión, allowlists, tolerancia, dos JSON, recálculo y retención de idempotencia.
- [ ] Confirmar que el Worker desplegable corresponde al contrato de [api/handlers/cod.js](../../api/handlers/cod.js); preparar un SHA de Worker para el cutover coordinado.
- [ ] Confirmar que no hay otro release/branch escribiendo sobre el paquete o las dependencias.

**NO-GO** si falta una decisión financiera, el SHA desplegado es desconocido o la revisión entiende la tabla de pagos de manera distinta.

### 1. Validación local descartable

Ejecutar solo en una máquina de desarrollo con PostgreSQL local 16+ instalado:

```bash
npm run test:cod
npm run test:cod:browser
npm run verify:cod:release-local
npm test
npm run build
```

El harness usa el módulo `pg` existente, crea un clúster temporal bajo `.wrangler/`, lo enlaza a `127.0.0.1`, exige `--verify-local`, verifica textualmente el gate y quita solo ese bloque de su copia SQL en memoria. No lee `.env`, no usa URL Supabase ni Management API y no aplica migraciones fuera de ese clúster. Casos cubiertos: deuda neta de COD con devolución, rechazo de sobrepago/tenant/actor/evidencia y conversión Bs inconsistente, pago parcial y final, snapshot Bs en abono/JSON, replay/idempotencia conflictiva, comparación de ambos COD JSON, resumen ledger posterior, grants mínimos y pre/postflight.

- [x] Verificación local de esta preparación (2026-10-06): `npm run test:cod` 45/45; `npm run test:cod:browser` PASS (Chromium, 12 aserciones); `npm run verify:cod:release-local` PASS (PostgreSQL 17 loopback, snapshots independientes, idempotencia, rollback y guardas). Clúster desechable detenido y limpiado.
- [x] UI muestra y envía snapshots independientes de dos tasas al reabrir modal tras el cambio de tasa (Chromium PASS).
- [x] Suite completa 644/644 y `npm run build` PASS en el checkout local el 2026-10-06.
- [ ] Repetir pruebas y build sobre el SHA exacto que el owner/DBA apruebe para desplegar; evidencia del checkout no equivale al SHA remoto.
- [ ] Si falla, no adaptar el script para apuntar a una DB compartida. Retener solo diagnóstico local y reparar el caso en un disposable.
- [ ] El esquema local acotado prueba las RPC del release, no todos los triggers/constraints/call-sites del principal.

### 2. Preflight principal read-only, en canal aprobado

Con ref del proyecto verificado por una persona autorizada y una conexión que garantice solo lectura, ejecutar únicamente [14_cod_preflight_readonly.sql](../../supabase/release/main/14_cod_preflight_readonly.sql). No compartir tokens, URLs firmadas, datos personales ni dumps.

- [x] Preflight de 2026-10-05: `missing_columns=null` (ninguna columna requerida ausente); PostgreSQL 17.6 y `pg_input_is_valid(text,text)` disponible. Las siete tablas requeridas existen.
- [x] Metadatos read-only adicionales (2026-10-05): owner `postgres`, `SECURITY DEFINER`, volatilidad `VOLATILE`, `search_path=public`; ACL explícita `postgres` + `service_role`; privilegios efectivos `service_role=true`, `authenticated=false`, `anon=false`. La consulta no devolvió el cuerpo (solo calculó un fingerprint MD5).
- [ ] Comparar ese fingerprint/definición con el artefacto aprobado de release 07 y obtener revisión del DBA. Los metadatos anteriores no demuestran que el cuerpo sea el correcto.
- [x] Preflight de 2026-10-05: ambas RPC COD están ausentes (`cod_summary_present=false`, `cod_reconciliation_present=false`). No se reemplazó ni modificó ningún objeto.
- [x] Preflight de 2026-10-05: `cod_conciliacion_idempotencia` está ausente. No se creó, modificó ni limpió tabla alguna.
- [x] Metadatos de historial read-only (2026-10-05): tabla `supabase_migrations.schema_migrations` presente con columnas `version`, `statements`, `name`; consulta filtrada por nombre/versión COD y variantes `14/014/0014` devolvió cero filas.
- [ ] El DBA debe comparar esto con el historial completo y determinar el proceso manual/auditable compatible con la deriva conocida; un filtro sin resultados no prueba que no haya un release equivalente bajo otro nombre. No usar `db push/reset/repair`.

**NO-GO** ante cambio inesperado, diferencia de contrato, grants excesivos, falta de backup aprobado o duda sobre identidad del proyecto.

### 3. Backup restaurable y ensayo

Antes de la ventana autorizada:

- [ ] Backup verificable del estado de base de datos, incluyendo datos financieros, audit e idempotencia; realizar restore/validación en ambiente disposable.
- [ ] Guardar los cuerpos previos completos de cualquier RPC que se vaya a reemplazar, ACL/owner/security/search_path, hash reproducible y resultado de restore.
- [ ] Ensayar forward y reversión en un disposable que represente las tablas, triggers, policies, defaults, constraints y funciones principales. Los stubs son aceptables solo para contrato aislado, no para validar cálculo final de comisión.
- [ ] Revisar cadenas de redefinición y dependencias; verificar firma de `recalcularcomisiondespacho_238b` y comportamiento de comisión real.
- [ ] No convertir la tabla de idempotencia existente ni borrar keys. El rollback de este paquete conserva la tabla por ser evidencia de reintentos financieros.

### 4. Paquete aprobable y ventana

El paquete actual es documentación de revisión, no copy-paste de producción. Antes del apply, el owner debe emitir versión aprobada que:

1. resuelva la aplicación según el proceso manual del principal;
2. incorpore el resultado del preflight vivo (sin hardcodear secretos ni fixtures en SQL);
3. conserve un guard contra reemplazar RPC/tablas desconocidas;
4. incluya backup/hash, rollback probado, firmas/grants finales y pasos exactos;
5. mantenga idempotencia/transacción atómica y preservación independiente de ambas columnas;
6. coordine el despliegue del Worker únicamente después de tener disponibles ambas RPC.

Apply solo después de autorización explícita del DBA/owner, con backup restaurable, ventana acordada, monitor responsable y plan de parar si cualquier precondición cambia. No ejecutar rollback SQL para “probarlo” en una base compartida.

### 5. Postflight y smoke

Después de un apply autorizado, ejecutar [14_cod_postflight_readonly.sql](../../supabase/release/main/14_cod_postflight_readonly.sql) con acceso de solo lectura. Deben estar presentes las firmas esperadas, ejecución concedida solo a `service_role`, summary `STABLE SECURITY INVOKER`, conciliador `VOLATILE SECURITY DEFINER`, `search_path=public` y evidencia de que el cuerpo actualiza ambas columnas usando sus valores calculados separados.

Smoke autorizado y acotado:

- [ ] Summary para COD pendiente y saldo neto tras devolución: `cargo_cod - abonos` correcto; devolución no figura como cash cobrado.
- [ ] Conciliación parcial no libera comisión; el summary cambia a parcial y conserva deuda restante.
- [ ] Replay con misma clave/payload no duplica abonos/auditoría; clave igual con payload distinto falla.
- [ ] Pago final deriva `cobrado`; revisión manual es falsa; comisión recalculada una sola vez según política.
- [ ] Ambos JSON retienen métodos no-COD propios, reflejan el mismo estado COD y evidencia/pagos añadidos; filas CxC y auditoría coinciden.
- [ ] Falla atómica por JSON/COD divergente, monto excesivo, rol/tenant, evidencia inválida o error al recalcular: sin medias escrituras.
- [ ] Registrar métricas, logs sin secretos y resultados de las comprobaciones; monitorear errores Worker/RPC durante la ventana.

No usar los harnesses staging mutables para este smoke ni borrar auditorías append-only. La base principal solo se utiliza si el dueño autorizó explícitamente fixtures limitados; preferir una base disposable compatible.

### 6. Reversión y parada

[14_cod_rollback_review.sql](../../supabase/release/main/14_cod_rollback_review.sql) también conserva su gate. No correr rollback por defecto: una vez registrados pagos reales, retirar la RPC no revierte el ledger, JSON, auditoría o recálculo. Seguir el runbook general [rollback-base-de-datos.md](rollback-base-de-datos.md); escalar a reconciliación financiera si hay actividad real.

- Si no hubo tráfico/filas, owner puede aprobar rollback de funciones tras comparar los marcadores/definiciones con release 14 y restaurar cuerpos previos del backup verificado.
- Si hubo tráfico, primero evaluar compatibilidad del Worker y las filas creadas; no borrar tabla de replay, CxC o auditoría. Coordinar rollback de Worker/DB de manera compatible y, si hace falta, un plan de corrección financiera por separado.
- Cualquier fallo de postflight, actor inesperado, transacción parcial, grants inesperados, hash no coincidente o error de saldo: detener el despliegue; no improvisar cambios en vivo.

## Estado de esta preparación

- SQL review-only y scripts pre/post/rollback están escritos; no se ejecutó SQL remoto.
- Las revisiones pendientes, firmas y gates siguientes están en [cod-release-14-review-packet.md](cod-release-14-review-packet.md).
- El harness disposable y la prueba local de UI verifican los contratos con fixtures; el esquema es una aproximación mínima, el recálculo usa un stub y ninguno constituye aprobación de producción.
- Preflight y metadatos de catálogo R14: **HECHOS 2026-10-05**; ambas RPC y tabla de idempotencia ausentes; dependencia existente con owner/config/ACL registrados sin exponer cuerpo; cero coincidencias de historial en el filtro COD/14. Sin firmas independientes, comparación de definición contra release 07, revisión DBA del historial completo, SHA de Worker aprobado, backup/restore probado, ensayo representativo, ventana ni autorización de apply, el estado sigue siendo **NO-GO**.
