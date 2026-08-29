# Plan maestro de salida a producción

**Proyecto:** Construacero Carabobo / Listo POS
**Entorno de validación:** `construacero-staging` (`spupqgkdsgohxxfoxydl`)
**Fecha de revisión:** 2026-08-17
**Estado:** preparación y validación; no autoriza todavía ningún deploy ni migración en producción.

### Cierre E2E de staging — 2026-08-17

La batería determinista del checkout `construacero-staging` terminó correctamente después de corregir el provisionamiento y la compatibilidad de limpieza:

- Worker `:8789` y proxy Vite `:5174`: HTTP 200 en `/api/ping`, ambos apuntando a `spupqgkdsgohxxfoxydl`.
- `npm test`: **227/227 tests** en **25 archivos**.
- `npm run build`: correcto; solo permanece el warning conocido de chunks grandes.
- `npm run test:e2e:staging`: **75/75 pasos PASS**.
- Evidencia: `tmp/e2e-staging/tester-2026-08-17T23-46-18-229Z.log`.
- Limpieza final: 0 productos E2E residuales y cliente E2E inactivo.
- Staging remoto: políticas RLS de comisiones, RPC de limpieza tenant-safe y configuración dedicada E2E (2 % Cabilla / 3 % otras categorías) aplicadas/verificadas.
- Producción: sin cambios, migraciones, despliegues ni credenciales reutilizadas.

El runner CLI es la evidencia de cierre y contiene cinco validaciones adicionales respecto de la lista histórica de la vista interactiva: preflight de esquema, búsqueda mejorada y tres pasos de fecha efectiva (aplicación, verificación de inmutabilidad y replay idempotente). `--keep-data` no se usó en la corrida final.

### Regla de comisión de choferes locales — 2026-08-15

- Un transportista marcado como `es_local=true` solo genera comisión del flete cuando el estado de destino normalizado es distinto de Carabobo.
- Un destino en Carabobo queda con `flete_regla_aplicada=nomina_carabobo`, `flete_comisionable=false` y no aparece como saldo liquidable; la nómina se mantiene en la aplicación externa.
- El estado usado, la regla, el porcentaje y el neto quedan congelados en `notas_despacho`; cambiar la ficha del cliente o la configuración no altera el histórico.
- La migración canónica del proyecto principal es `235_comision_flete_fuera_carabobo.sql`. El checkout `construacero-staging` conserva una migración 235 propia, por lo que aplica el mismo cambio como `236_comision_flete_fuera_carabobo.sql`.
- La liquidación y reversa RPC quedan restringidas a `service_role`; la API valida rol, cuenta, chofer local activo e idempotencia antes de invocarlas.

### Incidencia de consola resuelta — 2026-08-13

- El `404` de `script.googleusercontent.com` provenía de un Google Apps Script histórico incrustado en `useTasaCambio`. Se eliminó la URL fija; la fuente Google quedó opcional mediante `VITE_BCV_GOOGLE_SCRIPT_URL` y, por defecto, se usan las fuentes públicas de respaldo.
- Se retiraron los logs temporales de `useComisiones`, que imprimían datos de clientes/cotizaciones en la consola.
- Se añadieron guards para ignorar callbacks tardíos del listener de Supabase cuando React StrictMode desmonta una suscripción de desarrollo. Los dos `initialize()` iniciales pueden seguir apareciendo en desarrollo por StrictMode; no representan dos sesiones activas.
- Tests núcleo/staging: `187/187`; nómina: `188/188`; `npm run check:all`, builds y lint específico de los módulos modificados: correctos.

Después de actualizar el servidor local, hacer una recarga fuerte (`Ctrl+Shift+R`) para invalidar el bundle/service worker anterior.

### Corrección de tasas BCV USD/EUR — 2026-08-18

- Se confirmó que DolarAPI estaba entregando USD `772.5441` y EUR `894.49018618` con fecha `2026-08-17`, mientras el BCV vigente era USD `773.3125` y EUR `896.02946062` del `2026-08-18`.
- El Worker ahora prioriza el scraping directo del BCV con cabeceras de navegador y anti-cache, y usa `rates.dolarvzla.com/bcv/current.json` como respaldo validado por fecha. DolarAPI queda como último recurso del servidor, no como fuente BCV aceptada por el navegador.
- El proxy no-cachea respuestas en navegador/CDN; `refresh=1` fuerza una nueva consulta. USDT Binance P2P no cambió.
- Validación: handlers principal/staging devolvieron USD `773.3125` y EUR `896.02946062`; staging mantuvo `227/227` tests y build correcto. No hubo deploy ni cambios en producción.

### Incidencia del Tester en el paso 15 resuelta — 2026-08-13

- La corrida de las `16:35:19Z` pasó los pasos `0` a `14` y falló al crear el despacho con `CUENTA_TRANSPORTISTA_REQUERIDA`.
- La causa era doble: el operador desarrollador virtual no devolvía `cuenta_id`, y el Tester elegía un transportista existente ajeno a la corrida (`Prueba`) para el despacho base.
- `validateOperator` ahora asigna al desarrollador virtual la cuenta del usuario autenticado; el despacho base del Tester queda sin transportista y el transportista local determinista se crea más adelante con `cuenta_id` explícito.
- Se agregó un contrato automatizado para ese contexto de tenant y los archivos quedaron sincronizados en local/staging.
- Validación posterior: núcleo local/staging `194/194`; `npm run check:all` de staging correcto; builds principal y nómina correctos; lint específico sin errores nuevos.

El Tester todavía debe repetirse desde la interfaz para obtener el log completo de los 70 pasos. Esta corrección no aplica migraciones ni cambia producción.

### Incidencia del Tester en el paso 16 resuelta — 2026-08-13

- La corrida de las `17:17:38Z` pasó los pasos `0` a `15` y falló porque el despacho quedó con `total_usd=250` en lugar de `$260`.
- La causa estaba en el contrato normal de `/api/despachos/crear`: `costo_envio_usd` de la cotización es un envío estimado y se reemplaza por el `fleteUsd` real. El Tester omitía `fleteUsd`, por lo que calculaba `260 - 10 + 0 = 250`.
- El Tester ahora envía `fleteUsd=10`, equivalente al envío cotizado, y registra explícitamente esa sustitución. El cálculo esperado queda `260 - 10 + 10 = 260` sin cambiar el comportamiento del endpoint para la aplicación real.
- Se añadió un contrato automatizado del despacho determinista y se sincronizó local/staging.

### Incidencia de consola y limpieza del Tester — 2026-08-13

- React mostraba claves duplicadas porque el Tester conserva grupos repetidos en distintos tramos del flujo (`Despachos`, `Cuentas por Cobrar`, `Transportistas`, etc.) y usaba solo `group.name` como clave. Ahora la clave combina el índice de aparición y el nombre, sin cambiar el orden de los pasos.
- La limpieza del RPC `075` podía responder `400` por un JWT sin el rol virtual actualizado, por referencias append-only de `pagos_transportistas_despachos` y porque el esquema final de comisiones usa `despachoid`/`cotizacionid` (no los nombres legacy `despacho_id`/`cotizacion_id`). La migración `234_tester_cleanup_tenant_safe.sql` acepta los roles privilegiados, exige que la cotización pertenezca a `auth.uid()`, elimina esas referencias antes del despacho y revoca la ejecución a `anon`.
- El Tester ahora comprueba y registra cualquier error de `tester_cleanup_cotizacion` en vez de reportar falsamente una eliminación exitosa.
- La migración `234` y los cambios del Tester están sincronizados entre el proyecto local y `construacero-staging`. Deben aplicarse y verificarse exclusivamente en staging antes de repetir la corrida.
- El `409 Conflict` al crear `J-88888888-0` provenía del índice único de `clientes`: la pre-limpieza desactivaba el fixture anterior, pero no podía eliminarlo porque el RIF sigue siendo único. `stepCreateClient` ahora busca el cliente dentro de `cuenta_id`, lo reactiva y normaliza si existe, o lo inserta si no existe; nunca toca otro tenant.

---

## 1. Objetivo y criterio de salida

Liberar a producción únicamente cuando el código, el esquema Supabase, los permisos, los flujos comerciales y la operación de despliegue hayan sido verificados en staging y exista evidencia reproducible.

### Criterio de aprobación final

- [x] `npm run check:all` terminó con éxito en la ejecución histórica de staging (`194/194` núcleo, `188/188` nómina y ambos builds).
- [x] La validación más reciente (`npm test`) terminó con `227/227` tests en 25 archivos y el build frontend de staging fue correcto.
- [x] El Tester Determinista CLI terminó `75/75` pasos, conservó el log y eliminó sus fixtures.
- [x] El ensayo SQL reversible de staging termina con `PASS` y `ROLLBACK`.
- [x] La prueba E2E específica de transportistas locales pasa para porcentaje, tarifa fija, pago y reversa en dos transacciones staging revertidas.
- [ ] La matriz de permisos por rol pasa sin fugas de datos.
- [x] La paridad de migraciones y las columnas/RPCs críticas del esquema staging han sido comprobadas.
- [ ] El checkout de release está aislado y su diff fue revisado.
- [ ] Existe backup verificable y plan de rollback.
- [ ] Frontend, Worker y Supabase de producción apuntan al mismo proyecto.
- [ ] El smoke test posterior al deploy pasa en la URL real.

Mientras cualquiera de estos puntos esté pendiente, el estado es **no liberar**.

---

## 2. Estado inicial conocido

### Validado

- Build del frontend staging: correcto.
- Núcleo: última validación `227/227` tests en verde en 25 archivos (la corrida histórica de check:all había sido `194/194`).
- Nómina: `188/188` tests y build correcto.
- Tests específicos de transportistas: `10/10`.
- Correlativo 203 en staging: transportista local activo, flete `$150`, neto `$120`, saldo `$120`.
- Ensayo SQL reversible `228`: PASS; valida devolución, CxC, comisión, transportista local, pago FIFO, idempotencia y reversa; no dejó fixtures.
- Migración `232` y sus RPCs financieras fueron validadas en staging.
- Migraciones `233` y `234`, sus columnas/RPCs requeridas y la configuración de staging quedaron verificadas operacionalmente por el E2E final; la RPC de limpieza tenant-safe se aplicó en staging y el runner conserva compatibilidad acotada con esquemas legacy.
- Código ejecutable principal sincronizado entre proyecto local y staging.

### Bloqueadores actuales

1. Falta completar la matriz manual de permisos por rol, especialmente cambio de operador, RLS y endpoints protegidos.
2. Falta revisar y aislar el checkout de release: hay modificaciones, eliminaciones, archivos no rastreados y artefactos de varias sesiones; no debe desplegarse directamente.
3. El lint global sigue reportando errores heredados en handlers y artefactos generados; debe acotarse al alcance final o corregirse antes de usarlo como gate.
4. Falta preparar y comprobar backup/rollback y ejecutar el smoke test posterior en producción cuando exista autorización explícita.
5. La ejecución E2E verde de staging no sustituye las pruebas manuales de navegador, matriz de seguridad, volumen, backup/restauración ni la revisión del release.

---

## 3. Fase 0 — Congelación y alcance del release

**Objetivo:** saber exactamente qué cambios se van a liberar.

### Tareas

- [ ] No ejecutar resets, limpiezas masivas ni migraciones en producción.
- [ ] Separar cambios propios de esta salida de archivos locales, artefactos, bases `.freebuff` y documentación histórica.
- [ ] Comparar `src/`, `api/`, `worker.js`, configuraciones y migraciones con el commit base.
- [ ] Confirmar el conjunto de archivos que formará el release.
- [ ] Revisar que no entren `.env`, `.dev.vars`, tokens `sbp_`, service keys, dumps ni fixtures.
- [ ] Preparar una rama o paquete de release limpio cuando el propietario autorice la operación Git.

### Evidencia

- Lista de archivos del release.
- `git diff --stat` revisado.
- `git diff --check` sin errores.
- Secret scan sin credenciales.

### Puerta de salida

No continuar si hay archivos eliminados o modificados cuya pertenencia al release no esté clara.

---

## 4. Fase 1 — Cerrar la calidad automática

**Objetivo:** que las verificaciones automáticas sean una señal confiable.

### 4.1 Tests del núcleo

- [x] Revisar los fallos de `estadoLabels.test.js`, `format.test.js` y `whatsapp.test.js`.
- [x] Decidir para cada caso si el comportamiento actual es el contrato correcto.
- [x] Actualizar expectativas solamente cuando reflejen el comportamiento aprobado; no silenciar tests.
- [x] Ejecutar nuevamente las 194 pruebas: `194/194`.

### 4.2 Tests de nómina

- [x] Mantener `188/188` como requisito.
- [ ] Añadir, si aplica, una prueba de integración contra su proyecto Supabase aislado: tenant, períodos, asistencia, tasas y RLS.

### 4.3 Lint y build

- [x] Ejecutar lint con alcance explícito sobre el código modificado, excluyendo `dist`, copias y artefactos.
- [ ] Resolver los errores heredados de handlers o documentar formalmente los que queden fuera del alcance del release; no usar `eslint .` como gate mientras incluya `dist`.
- [ ] Ejecutar:

```bash
cd construacero-staging
npm run check:all
```

### Puerta de salida

- [x] Tests del núcleo: `194/194`.
- [x] Nómina: `188/188`.
- [x] Builds principal y de nómina correctos.
- [ ] Lint del alcance del release sin errores nuevos; el lint global actual falla por errores heredados y artefactos compilados.

---

## 5. Fase 2 — Validar base de datos y migraciones

**Objetivo:** asegurar que el código y el esquema remoto son compatibles.

### Staging

- [x] Comparar hashes de todas las migraciones originales.
- [x] Confirmar las extensiones de staging `227`, `229` y `230`.
- [x] Confirmar los archivos de migración `231`, `232`, `233` y `234` y sus columnas/RPCs esperadas.
- [x] La ejecución E2E del 2026-08-17 confirmó que staging resuelve las RPCs vigentes de productos y que la limpieza tenant-safe funciona; no se observaron overloads bloqueantes.
- [x] Consultar `information_schema.columns` y funciones críticas; quedan índices, triggers, políticas RLS y publicaciones Realtime para la auditoría final.
- [ ] Verificar específicamente:
  - [ ] `notas_despacho.flete_neto_transportista_usd`
  - [ ] `notas_despacho.flete_pct_aplicado`
  - [ ] `notas_despacho.flete_pagado`
  - [ ] `notas_despacho.aprobado_por_nombre`
  - [ ] `notas_despacho_items.cantidad_original`
  - [ ] `notas_despacho_items.precio_original`
  - [ ] `notas_despacho_items.origen`
  - [ ] `notas_despacho_items.es_prestamo`
  - [x] RPCs atómicas de inventario, devoluciones y transportistas.

### Ensayo SQL reversible

- [x] Parametrizar `v_cuenta` en `228_e2e_devolucion_staging.sql` o resolverla desde un operador privilegiado de staging.
- [x] Mantener la protección contra bases cuyo nombre parezca producción.
- [x] Ejecutar con `ON_ERROR_STOP=1` en una base staging/clone.
- [x] Verificar `PASS` y ausencia de fixtures después de `ROLLBACK`.
- [x] Resolver la reversión financiera mediante la RPC `232` y validarla en el ensayo reversible.

### Producción, antes de modificarla

- [ ] Crear backup/snapshot verificable.
- [ ] Ejecutar únicamente consultas de lectura para comprobar el estado actual.
- [ ] Comparar el esquema real contra el esquema esperado.
- [ ] Preparar orden de migración y ventana de mantenimiento.
- [ ] Identificar migraciones no transaccionales o que requieran pasos especiales.
- [ ] Preparar rollback operativo: restauración, reversión de Worker y desactivación de feature flags.

### Puerta de salida

No desplegar código que consulte columnas o RPCs que todavía no existan en producción.

---

## 6. Fase 3 — E2E automatizado y funcional

**Objetivo:** validar el comportamiento completo, no solamente funciones aisladas.

### 3.1 Tester Determinista

Ejecutar en staging con el operador desarrollador (el paso de reporte de transportistas falla deliberadamente si se usa supervisor):

- [x] Aplicar/verificar en staging las migraciones y reglas requeridas (`233`, `234`, `236`), RLS de comisiones y configuración E2E.
- [x] Recargar el bundle de staging y repetir la limpieza previa.
- [x] Confirmar que el despacho base no selecciona transportistas existentes y que el transportista determinista queda dentro de la cuenta autenticada.
- [x] Inventario y Kardex.
- [x] Clientes y cotizaciones.
- [x] Despachos y cambios de estado.
- [x] Comisiones y CxC.
- [x] Anulación y reciclaje.
- [x] Venta rápida.
- [x] Transportistas locales: `es_local`, flete, neto y reporte incorporados al tester.
- [x] Regla de alcance: Aragua/exterior comisionable y Carabobo excluido por nómina externa.
- [x] Ejecutar y archivar el Tester Determinista completo: `75/75`, log `tmp/e2e-staging/tester-2026-08-17T23-46-18-229Z.log`.
- [x] Multi-precio.
- [x] Movimientos por lote.
- [x] Reasignación.
- [x] Health checks de API, RLS, configuración, rutas y stock.
- [x] Limpieza final y confirmación de cero residuos.

### 3.2 Caso específico de transportista local

Crear fixtures temporales con:

- [x] Transportista `es_local=true`, relación proveedor/contratista.
- [x] Configuración global por porcentaje.
- [x] Configuración global por tarifa fija.
- [x] Venta normal con flete mayor que cero.
- [x] Venta rápida con flete mayor que cero.
- [x] Snapshot correcto en `notas_despacho`.
- [ ] Aparición en reporte sin rango y con rango de fechas.
- [x] Pago FIFO e idempotencia.
- [x] Reversión del pago.
- [x] Confirmar porcentaje y tarifa fija en dos corridas transaccionales de staging; ambas terminaron con `PASS` y `ROLLBACK`.
- [ ] Transportista no local excluido del reporte.
- [x] Despacho local en Carabobo excluido de pago, saldo e idempotencia.
- [x] Limpieza de todos los fixtures.

### 3.3 Flujo comercial manual

- [ ] Vendedor crea cliente y cotización.
- [ ] Supervisor/admin revisa y aprueba.
- [ ] Logística entrega.
- [ ] Se valida stock, Kardex, comisión, CxC y auditoría.
- [ ] Se generan Nota de Entrega, Orden de Despacho, reportes, PDF y WhatsApp.
- [ ] Se prueban pagos contado, crédito, mixto, abono y devolución.

### Puerta de salida

Cada flujo debe tener evidencia: captura/log, identificador del fixture, estado final y confirmación de limpieza.

---

## 7. Fase 4 — Matriz de seguridad y permisos

**Objetivo:** verificar que la salida no exponga datos ni acciones administrativas.

Para cada rol (`vendedor`, `vendedor_sin_comision`, `supervisor`, `administracion`, `logistica`, `jefe`, `desarrollador`):

- [ ] Login y cambio de operador.
- [ ] PIN correcto, PIN incorrecto y longitud esperada.
- [ ] JWT y metadata del operador activo.
- [ ] Logout y cambio de operador sin mezclar cachés.
- [ ] Lectura de datos propios vs datos ajenos.
- [ ] Acceso a rutas permitidas y redirección de rutas prohibidas.
- [ ] Aprobación, entrega, anulación y edición de despachos.
- [ ] Pago y reversión de transportistas.
- [ ] Acceso a reportes, auditoría, usuarios y configuración.
- [ ] Rechazo de requests sin sesión, con token vencido o con operador inválido.
- [ ] CORS y rate limiting.
- [ ] Confirmar que la service key nunca aparece en bundles, respuestas o logs.

---

## 8. Fase 5 — Pruebas no funcionales

**Objetivo:** comprobar que la aplicación se puede operar con datos reales.

- [ ] Chrome/Edge y navegador móvil.
- [ ] Resoluciones móvil, tablet y escritorio.
- [ ] PWA, service worker, actualización de versión y caché antiguo.
- [ ] Recuperación después de perder/restaurar conexión.
- [ ] Reportes con volumen representativo y más de una página/lote.
- [ ] Tiempos de `/api/*`, consultas Supabase y generación de PDFs.
- [ ] Fallos de Supabase: respuesta JSON consistente, nunca cuerpo vacío.
- [ ] Logs del Worker sin secretos y con correlación de errores.
- [ ] Backup y restauración en un clone de prueba.
- [ ] Prueba de concurrencia en creación de correlativos, entrega atómica y pagos idempotentes.

---

## 9. Fase 6 — Preparación de producción

**Objetivo:** evitar que staging y producción se crucen.

### Variables y secretos

- [ ] Frontend de producción usa únicamente `VITE_SUPABASE_URL` y anon key de producción.
- [ ] Worker de producción usa `SUPABASE_URL`, anon key y service key del mismo proyecto.
- [ ] No hay placeholders vacíos en `wrangler`/CI que sobrescriban secrets.
- [ ] No se copian `DEV_MASTER_PIN_*` de staging a producción.
- [ ] Revocar/rotar el token de Management `sbp_...` usado para staging.
- [ ] Revisar secrets de Vercel, Cloudflare y GitHub Actions.

### Orden de publicación

1. [ ] Backup de producción.
2. [ ] Aplicar migraciones compatibles y verificar esquema.
3. [ ] Desplegar Worker/API.
4. [ ] Ejecutar smoke de API.
5. [ ] Desplegar frontend.
6. [ ] Invalidar/actualizar service worker si corresponde.
7. [ ] Ejecutar smoke funcional con una cuenta de prueba controlada.
8. [ ] Retirar/limpiar la cuenta de prueba y sus datos.

No usar reset de base ni copiar datos de staging a producción.

---

## 10. Fase 7 — Smoke test y monitoreo post-deploy

Durante los primeros minutos después de publicar:

- [ ] URL frontend carga sin errores de consola.
- [ ] `/api/ping` responde `200`.
- [ ] Request sin sesión responde `401` en endpoints protegidos.
- [ ] Login real funciona.
- [ ] Cambio de operador funciona.
- [ ] Lectura de clientes/productos/despachos funciona.
- [ ] Crear una operación mínima controlada funciona.
- [ ] Reporte y auditoría cargan.
- [ ] Worker, Vercel y Supabase no muestran errores nuevos.
- [ ] Se monitorean errores durante 30–60 minutos.

### Condiciones de rollback

Revertir Worker/frontend o detener la operación si ocurre cualquiera de estos casos:

- errores 5xx en rutas críticas;
- mezcla de datos entre proyectos;
- fallo de RLS o acceso indebido;
- pérdida de stock, comisión o CxC;
- correlativos duplicados;
- migración incompleta;
- service key ausente o expuesta.

---

## 11. Evidencias que deben quedar archivadas

- Resultado de `npm run check:all`.
- Resultado de tests de nómina.
- Resultado del Tester Determinista.
- Salida del ensayo SQL reversible.
- Matriz de permisos firmada/revisada.
- Hashes/paridad de migraciones.
- Backup y comprobación de restauración.
- URLs/versiones desplegadas.
- Smoke test post-deploy.
- Incidencias y decisión de liberar o revertir.

**Regla final:** si una prueba falla y se marca como "conocida", debe existir una decisión explícita de producto/operación. No se debe convertir un fallo en verde simplemente ocultándolo.
