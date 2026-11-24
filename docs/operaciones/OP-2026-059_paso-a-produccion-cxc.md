# OP-2026-059 — Paso a producción de los arreglos de Cuentas por Cobrar (publicado 2026-11-24)

**Fecha:** 2026-11-24 · **Producción:** publicado el 2026-11-24 con aprobación del dueño (ver §10) · **Staging:** solo se usó para ensayos que se deshacen solos
**Viene de:** [plan OP-2026-048](../plans/OP-2026-048_plan-arreglo-26-fallas-staging.md) y su cierre [OP-2026-058](OP-2026-058_prueba-final-y-reporte-clientes.md). Lleva a producción lo de [OP-042](OP-2026-042_arreglos-cxc-staging.md) y [OP-049](OP-2026-049_aviso-error-y-doble-clic-abonos-staging.md) a [OP-057](OP-2026-057_acceso-y-consistencia-staging.md).

## En resumen

- **Publicado en producción el 2026-11-24** con tu aprobación: base de datos (migraciones 301-309) y código ([solicitud #66](https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/66), commit `5a323d22`). Detalle y verificaciones en §10.
- Se prepararon **9 cambios de base de datos** (migraciones 301 a 309), cada uno con su **reversa** (el archivo para deshacerlo), y se llevó el código al programa de producción. Las **1.230 pruebas automáticas pasan** y la app **se construye sin errores**.
- **Hallazgo importante:** producción no es una copia exacta de staging. Las devoluciones de producción pasan por **otra función** que la que se arregló en staging. Si se hubieran copiado los archivos de staging tal cual, el arreglo de las devoluciones (G1) **no habría funcionado** en producción y se habría **pisado** el cálculo de comisiones que producción tiene más nuevo. Por eso las versiones de producción se escribieron partiendo de lo que **hoy** tiene producción.
- **Ensayo sin riesgo:** las 9 migraciones de producción se probaron sobre staging dentro de una "caja" que se deshace sola al final. Funcionaron las 8 pruebas (devolución con abono confirmado, reabrir con pagos, abono sin duplicar, anular con motivo, saldo a favor, anular con pagos anotados, etc.). También se probaron las reversas: dejan producción **exactamente** como está hoy (comprobado con huellas digitales de cada función). Staging quedó igual que antes.
- Aparecieron **3 fallas nuevas que solo existen en staging** (N16, N17, N18). La versión de producción ya no las tiene. Están en el [registro de fallas](REGISTRO-FALLAS-CODIGO.md).
- **Qué tienes que decidir tú:** (1) aprobar el paso a producción; (2) aparte, cada corrección de datos (N4, Encendo, Los Guayos, casos de caja); (3) cómo guardar el código en GitHub (hay trabajo de otros casos sin publicar en los mismos archivos, ver §7).
- **Recordatorio:** borra en supabase.com la llave de producción `sbp_…` que se pegó en un chat anterior (§9).

> **Glosario rápido.** *Migración*: una actualización del "manual de instrucciones" de la base de datos (agrega tablas, reglas o funciones). *Reversa*: el archivo que deshace esa actualización. *Función de la base*: una receta que la base ejecuta toda de una vez, sin que nadie se meta en medio. *Worker*: el servidor en la nube que recibe lo que hace la pantalla. *Publicar*: subir el código nuevo para que lo usen los usuarios.

## 1. Qué se preparó

### 1.1 Migraciones de base de datos (carpeta `supabase/migrations/`)

| Producción | Viene de staging | Caso | Qué hace | Reversa |
|---|---|---|---|---|
| `301_cxc_reparto_devoluciones.sql` | `300_staging_…` | OP-042 | Reparto común de pagos (el mismo en ficha, reporte y devoluciones); vista de "pagos de más"; la devolución ve los pagos sueltos y puede anular en el mismo paso un abono que el operador confirma que era la misma devolución | `301_…_rollback.sql` |
| `302_cxc_abono_clave_unica.sql` | `301_staging_…` | OP-049 | Huella única por abono (no se guarda dos veces) | `302_…_rollback.sql` |
| `303_auditoria_categorias_y_abono_atomico.sql` | `302_staging_…` | OP-050 | La auditoría acepta las categorías que faltaban (DESPACHO, VEHICULO, CONFIG, COMISIONES); abono + auditoría en un solo paso | `303_…_rollback.sql` |
| `304_cxc_saldo_favor_atomico.sql` | `303_staging_…` | OP-051 | Cargar, devolver y cruzar saldo a favor en un solo paso | `304_…_rollback.sql` |
| `305_despacho_pagos_al_reabrir_anular.sql` | `304_staging_…` | OP-052 | Reabrir y anular despachos sin perder pagos | `305_…_rollback.sql` |
| `306_edicion_profunda_cxc.sql` | `305_staging_…` | OP-053 | Edición profunda: artículos y cuenta del cliente en un solo paso | `306_…_rollback.sql` |
| `307_devolucion_donacion.sql` | `306_staging_…` | OP-054 | Devolver lo donado no da crédito (salvo autorización con motivo) | `307_…_rollback.sql` |
| `308_cxc_nada_se_borra_sin_rastro.sql` | `307_staging_…` | OP-055 | Archivo de movimientos borrados (copia completa de todo lo que se borre) y "anular con motivo" | `308_…_rollback.sql` |
| `309_reparto_dos_deudas.sql` | `308_staging_…` | OP-057 | Reparto correcto cuando un despacho tiene dos deudas (crédito y cobro a destino) | `309_…_rollback.sql` |

**Por qué los números no coinciden con staging:** producción ya tenía una migración 300 (índices de velocidad). Por eso las de CxC empiezan en 301. La de staging 300 (OP-042) también se incluye, porque las demás dependen de ella.

**Nombres sin "_staging":** las funciones nuevas quedan con su nombre normal en producción: `reabrir_despacho_con_pagos`, `anular_despacho_con_pagos`, `editar_despacho_profundidad_con_cxc`, `devolucion_con_donacion` y `cxc_anular_movimiento`. Se comprobó que **ninguna existe hoy** en producción (no se pisa nada).

**Permisos:** todas las funciones nuevas quedan solo para el servidor (como el resto de producción). Nadie puede llamarlas directamente desde fuera.

### 1.2 Diferencias entre staging y producción que obligaron a adaptar (comparación de solo lectura)

| Qué | Staging | Producción | Qué se hizo |
|---|---|---|---|
| Función que hace las cuentas de una devolución | `ajustar_finanzas_devolucion_atomica` | `ajustar_finanzas_devolucion_neta` (la de staging no se usa en producción) | La 301 modifica `_neta` **partiendo de su texto actual en producción**, con los mismos 4 cambios de OP-042 |
| Cálculo de comisión dentro de la devolución | versión vieja (238b) | versión más nueva (reparte entre dueño del cliente y designado del sábado) | Se conserva la de producción |
| Permiso de la función de devoluciones | abierta a cualquier sesión (falla **N16**) | solo el servidor | Se mantiene "solo el servidor" |
| Reversión al reabrir un entregado | `revertir_entrega_finanzas_atomica_staging` | `revertir_entrega_finanzas_idempotente` | `reabrir_despacho_con_pagos` llama a la de producción |
| Bloqueo "tiene cobros reales" al devolver un despacho **aprobado** | se quitó sin reemplazo (falla **N17**) | existe | Se mantiene para aprobados; el **entregado** pasa a la decisión de pagos |
| Fecha de vencimiento al crear una deuda en edición profunda | no se guarda (falla **N18**) | el servidor la guardaba | La 306 la guarda |
| Lista de categorías de auditoría | 14 | 10 (faltan DESPACHO, VEHICULO, CONFIG, COMISIONES) | La 303 las agrega |
| Columna `idempotency_key`, tabla de borrados, disparador, vista de pagos de más | existen | no existen | Las crean 301, 302 y 308 |
| `editar_despacho_profundidad`, `registrar_devolucion_parcial_idempotente`, disparadores de saldo | iguales | iguales | Nada |

Datos de producción leídos hoy: 1.050 movimientos de cuentas por cobrar, 2.266 despachos entregados, 119 abonos reales enlazados a un despacho.

### 1.3 Código llevado a producción

Del Worker (servidor): `api/handlers/cxc.js`, `api/handlers/despachos.js`, `api/handlers/cotizaciones.js`, `api/lib/audit.js`, `api/lib/cxcUtils.js`, `worker.js`.
De la pantalla: `src/hooks/useCuentasCobrar.js`, `src/hooks/useDespachos.js`, `src/components/clientes/FichaClienteModal.jsx`, `src/components/despachos/` (`DespachoCard`, `DevolucionParcialModal`, `DevolverAnularModal`, `EditDespachoModal`, `EditarItemsDespachoModal`, `EditarPagoEntregadoModal`), `src/components/ui/ConfirmModal.jsx` (solo saltos de línea en el detalle), `src/views/DespachosView.jsx`, `ReportesView.jsx`, `CotizacionesView.jsx`, `VentaRapidaView.jsx`.
Reglas compartidas nuevas: `src/utils/cxcReparto.js`, `donacionDevolucion.js`, `formaPagoReglas.js`, `cxcSaldos.js`, `leerPaginado.js`.

Cómo se llevó: no se copiaron los archivos de staging (son distintos a los de producción en cientos de líneas). Se aplicaron **solo los cambios de CxC**, uno por uno, sobre los archivos de producción. Lo que producción tenía de más se conservó (por ejemplo, el control de origen de las peticiones, el aviso de auditoría con tiempo límite, la pantalla de Crédito más nueva). `Toast.jsx` no cambia: producción ya tenía el arreglo de N11.

Pruebas: se llevaron las 10 pruebas nuevas de staging (con los nombres de producción) y se actualizaron 5 pruebas viejas que esperaban el comportamiento anterior (por ejemplo, "reabrir un entregado con cobros se bloquea" pasa a "pide la decisión"). Resultado: **124 archivos, 1.230 pruebas, todas en verde**; `npm run build` correcto. Las pruebas nuevas quedaron permitidas en `.gitignore` para que se guarden en GitHub.

Scripts usados (todos en [`OP-2026-059_scripts/`](OP-2026-059_scripts/)):
- `comparar_esquema.py` y `dump_funciones.py`: comparación de solo lectura producción ↔ staging; copias de las funciones en `defs/prod` y `defs/staging`.
- `generar_migraciones_prod.py`: arma las migraciones 301-309 de producción.
- `portar_despachos.py`: aplica los cambios de CxC en `despachos.js` de producción.
- `ensayo_staging.py` + `ensayo_pruebas.sql`: ensayo con 8 pruebas en staging, deshecho al final.
- `ensayo_reversas.py`: aplica todo y lo deshace con las reversas; compara con producción.

## 2. Orden exacto de aplicación (cuando lo apruebes)

**Regla de oro: primero la base de datos, después el código.** El código viejo funciona bien con la base nueva (se comprobó: los cambios de base no rompen nada de lo que hoy usa la app). Al revés no: el código nuevo necesita las funciones nuevas.

| Paso | Qué | Quién / cómo | Tiempo aprox. |
|---|---|---|---|
| 0 | **Respaldo** de producción justo antes (copia completa de la base) | Claude, con tu permiso, o tu respaldo semanal si es del mismo día | 5 min |
| 1 | Aplicar `301_cxc_reparto_devoluciones.sql` | Claude con tu aprobación, o copiar y pegar en el editor SQL de supabase.com | 1 min |
| 2 | Aplicar `302_cxc_abono_clave_unica.sql` | igual | segundos |
| 3 | Aplicar `303_auditoria_categorias_y_abono_atomico.sql` (va sin "caja" a propósito; ver nota) | igual | segundos |
| 4 | Aplicar `304_cxc_saldo_favor_atomico.sql` | igual | segundos |
| 5 | Aplicar `305_despacho_pagos_al_reabrir_anular.sql` | igual | segundos |
| 6 | Aplicar `306_edicion_profunda_cxc.sql` | igual | segundos |
| 7 | Aplicar `307_devolucion_donacion.sql` | igual | segundos |
| 8 | Aplicar `308_cxc_nada_se_borra_sin_rastro.sql` | igual | segundos |
| 9 | Aplicar `309_reparto_dos_deudas.sql` | igual | segundos |
| 10 | Revisión rápida de la base (§4.1) | Claude, solo lectura | 2 min |
| 11 | Guardar el código en GitHub y publicar (solicitud de cambio → unión a `main`; Vercel y el Worker se publican solos) | Claude con tu aprobación | 10 min |
| 12 | Pruebas después de publicar (§4.2 y §4.3) | Claude (lectura) + administración (pantalla) | 15 min |

Nota del paso 3: agregar categorías a la lista de la auditoría tiene que quedar confirmado antes de usarse; por eso ese archivo no va dentro de una "caja" de todo o nada. Cada línea es segura por sí sola.

Momento recomendado: fuera de horario (nadie registrando abonos ni despachos). Entre el paso 1 y el 11 la app sigue funcionando con el código viejo; desde el paso 1 las devoluciones ya usan el reparto correcto (G1).

## 3. Cómo deshacer cada paso

Las reversas se aplican **en orden inverso** (primero la del último paso que se aplicó).

| Si hay que deshacer… | Qué hacer | Qué se pierde |
|---|---|---|
| El código publicado | En Vercel, "Instant Rollback" al despliegue anterior; en Cloudflare, `npx wrangler rollback` (ver [runbook](../runbooks/deploy-produccion.md)) | Nada de datos |
| 309 | `309_reparto_dos_deudas_rollback.sql` (vuelve al reparto de la 301) | Nada |
| 308 | `308_cxc_nada_se_borra_sin_rastro_rollback.sql` | **Borra el archivo de movimientos borrados.** Antes, exportarlo si tiene filas |
| 307 | `307_devolucion_donacion_rollback.sql` | Nada (las devoluciones ya hechas quedan) |
| 306 | `306_edicion_profunda_cxc_rollback.sql` | Nada |
| 305 | `305_despacho_pagos_al_reabrir_anular_rollback.sql` | Nada |
| 304 | `304_cxc_saldo_favor_atomico_rollback.sql` | Nada |
| 303 | `303_…_rollback.sql` quita la función del abono. **Las categorías nuevas no se pueden quitar** (la base no lo permite); no hacen daño | Nada |
| 302 | `302_cxc_abono_clave_unica_rollback.sql` | Se pierden las huellas guardadas (no los abonos) |
| 301 | `301_cxc_reparto_devoluciones_rollback.sql` (deja las dos funciones de devolución **idénticas** a hoy) | Nada |

**Importante:** si ya se publicó el código nuevo, primero se deshace el código y después la base; si no, la pantalla llamaría funciones que ya no existen.

Ensayo de las reversas: aplicadas todas y deshechas todas sobre staging, las dos funciones de producción que se modifican quedaron con la **misma huella digital** que hoy en producción, y no quedó ningún objeto nuevo (comprobado con `ensayo_reversas.py`).

## 4. Qué probar justo después de publicar

### 4.1 Base de datos (Claude, solo lectura, después del paso 9)
- [ ] Existen las funciones nuevas y solo el servidor puede usarlas.
- [ ] La lista de categorías de auditoría tiene 14 valores.
- [ ] Existen la columna `idempotency_key`, la tabla `cxc_movimientos_borrados` y su disparador.
- [ ] Los saldos guardados de los clientes **no cambiaron**: anotar la suma de deudas y de saldos a favor de todos los clientes justo antes del paso 1 y compararla después del paso 9 (debe ser igual al centavo).

### 4.2 Servidor (Claude)
- [ ] La app carga; `GET /api/ping` responde 200.
- [ ] Las rutas nuevas sin sesión responden 401 (existen y piden sesión): `/api/despachos/pagos-en-juego`, `/api/despachos/devolucion-preview-cxc`, `/api/cxc/movimientos-borrados`.
- [ ] Ningún error nuevo en el registro de errores del sistema en la primera hora.

### 4.3 Pantalla (administración, con operaciones reales del día)
- [ ] Abrir la ficha de un cliente con mucho historial (ej. REYKAR): se ven **todos** los movimientos y, si tiene, el aviso de "pagado de más".
- [ ] Reportes → Crédito: aparece "Pagos de más sin deuda" (16 clientes, $4.969,71, si no se corrigió nada antes).
- [ ] Registrar el próximo abono real: sale el mensaje verde y aparece en la ficha; en la auditoría queda `REGISTRAR_ABONO`. Hacer doble clic a propósito no debe guardar dos.
- [ ] En un despacho entregado **con** abono, el botón de reabrir pregunta qué hacer con el dinero (se puede cancelar sin hacer nada).
- [ ] Al anular un despacho pendiente, pide motivo.
- [ ] (Opcional, deja rastro) Con un cliente de prueba: abono de $1, anularlo con motivo y ver la copia en "movimientos anulados" de la ficha.

## 5. Riesgos

| Riesgo | Qué tan probable | Qué lo cubre |
|---|---|---|
| La devolución de producción (función `_neta`) se comporta distinto a staging | Bajo | Se probó la versión de producción en el ensayo (T1 y T2) con datos reales de staging. Pero las pruebas completas en navegador de OP-054/OP-042 corrieron contra la versión de staging. Recomendado: repetir una devolución real con cuidado el primer día |
| Una devolución que antes descontaba deuda ahora va a saldo a favor (porque ve pagos sueltos) | Esperado | Es justamente el arreglo G1. Avisar a administración |
| Reabrir y anular ahora piden decisiones y motivo | Esperado | Avisar a administración y logística (2 minutos de explicación) |
| El primer día aparecen "pagos de más" que antes no se veían | Esperado | Son los $4.969,71 ya estudiados; las correcciones de §6 los bajan |
| Si se usa el "reinicio de fábrica" (borrar todo) del panel de administración, el archivo de movimientos borrados guarda copia de todo | Muy bajo (no se usa en producción) | Tenerlo en cuenta si algún día se usa |
| Unos minutos entre que se publica la pantalla y el Worker | Bajo | Si la pantalla nueva llega antes, el aviso de pagos dice "no disponible" y el servidor igual pide la decisión |
| Avisos de calidad de código (no son errores): la herramienta de revisión marca algunos patrones en `DevolverAnularModal` y `FichaClienteModal` que ya existían en staging | Sin efecto para el usuario | Anotado aquí; no afecta pruebas ni construcción |

## 6. Correcciones de datos (cada una necesita tu aprobación aparte, **después** de publicar)

Ninguna se ejecutó. Se recomienda hacerlas **después** de publicar, porque así el archivo de movimientos borrados y la auditoría guardan rastro de todo.

| # | Corrección | Cómo se haría | Efecto (simulado) |
|---|---|---|---|
| D1 | **N4:** 13 registros viejos de "pago con saldo a favor" guardados como abono | Guion listo [`op056_n4_correccion.sql`](OP-2026-040_scripts/op056_n4_correccion.sql): copia de respaldo, anotación en auditoría y cambio de tipo; revisa que sean 13 filas y $1.014,03 antes de confirmar | Pagado de más escondido baja $1.013,69; solo El Gran Adonay pasa a deber $0,34 ([OP-056](OP-2026-056_repaso-y-simulacion-n4-staging.md)) |
| D2 | **Decoraciones Encendo:** anular el "Cruce – NO PROCEDE" de $2.144 (27-jul) | Con la app ya publicada, administración lo anula desde la ficha con "anular con motivo" (queda copia y auditoría). No hace falta SQL | Debe $195 (despacho #1954) y conserva $4,30 a favor ([OP-041](OP-2026-041_casos-cxc-caso-por-caso.md)) |
| D3 | **Construacero Los Guayos:** ¿lo donado debía dar crédito? ($805) | Primero tu decisión. Si la respuesta es "no", se prepara un guion propio (no se puede anular desde la ficha porque son movimientos de devolución, que la app protege a propósito) | Pasaría a deber $1.700,50 y $0 a favor ([OP-046](OP-2026-046_donaciones-y-registro-de-abonos.md)) |
| D4 | **Casos de caja** (Solidere, Medrano, Angel Pineda, REYKAR, Yahveh, Yhoel Sanchez, Carlos Escalona, A_40, Adalberto Rojas, Beatriz Landadeta) | Solo cuando caja confirme cada pago; cada abono que falte se registra desde la ficha y cada repetido se anula con motivo | Ver la tabla 2.3 de [OP-058](OP-2026-058_prueba-final-y-reporte-clientes.md) |
| D5 | Revisar los **378 despachos anulados con pagos anotados** | Con administración, caso por caso | [OP-052](OP-2026-052_reabrir-anular-sin-perder-pagos-staging.md) |

## 7. Cómo guardar el código (antes de publicar)

### 7.0 Publicación preparada (2026-11-24)

- **Respaldo previo:** antes de tocar nada se guardó una copia de todo el trabajo sin guardar de la carpeta principal en `Desktop\respaldo-OP-2026-059-20261124-072047` (fuera del proyecto). Ahí están los 178 archivos cambiados o nuevos y una lista del estado. Si algo sale mal, se puede volver a ese punto.
- **Producción va más adelante que la carpeta de trabajo.** La versión publicada (`main`) ya tiene OP-031, OP-032, OP-035 y OP-036, y la carpeta principal no. Por eso la publicación se armó en una **carpeta aparte**, `Desktop\construacero-publicacion-op059` (rama `feat/op-059-cxc-produccion`), partiendo de lo publicado y agregando solo lo de CxC. La carpeta principal no cambió de rama.
- Cómo se armó: con [`preparar_rama_publicacion.py`](OP-2026-059_scripts/preparar_rama_publicacion.py). Cada archivo cambiado se combinó en 3 vías (lo publicado + lo de CxC), así no se pierde nada de lo que producción ya tiene. Quedan 29 archivos cambiados y 156 nuevos (código, pruebas, migraciones 301-309 y documentos de OP-037 a OP-060).
- **OP-025 separado a mano:** `useDespachos.js` traía mezclado el arreglo de búsquedas OP-025, que no está publicado y depende de otro archivo que no va aquí. En la carpeta de publicación solo quedaron las partes de CxC. `VentaRapidaView.jsx` ya no tiene mezcla, porque OP-032 está publicado.
- `REGISTRO.md`: se tomaron las filas de lo publicado y se agregaron las de CxC. Las filas de otros casos sin publicar (OP-023, 025, 028, 029, 030 y 033) no van en esta publicación; cada caso las agrega cuando se publique.
- **Verificado en la carpeta de publicación:**
  - 119 archivos con **1.201 pruebas en verde**. Una prueba ya publicada pide el archivo de configuración local, que a propósito no se copió porque tiene claves; con valores de prueba pasa.
  - La app **se construye sin errores**.
  - No hay claves ni contraseñas en los archivos.
- **Revisión de estilo:** el proyecto ya traía 192 avisos de estilo graves en archivos que esta publicación no toca, y la publicación automática no los revisa. En los archivos de este caso:
  - Se corrigió un detalle real: en la ventana de devolver/anular, las opciones de pago se rearmaban en cada redibujo de pantalla.
  - Quedan 3 avisos del mismo tipo que ya existen en el resto del programa. No cambian lo que hace la pantalla.
  - `cxc.js` pasó de 5 avisos a 0.
- Después se publicó con tu aprobación (§10).

Al guardar el código hay que tener en cuenta:

- **Archivos de este caso:** los de §1.3, las 9 migraciones y sus reversas, las 10 pruebas nuevas y las 5 actualizadas (`despachosAtomic`, `despachosReversionDevoluciones`, `despachosReversionRelease17`, `audit`, `EditarPagoEntregadoModal`), `.gitignore`, `README.md`, `docs/operaciones/matriz-migraciones.md`, este documento, `REGISTRO.md`, `REGISTRO-FALLAS-CODIGO.md` y la carpeta `OP-2026-059_scripts/`.
- **Cuidado, archivos mezclados:** `src/hooks/useDespachos.js` ya tenía cambios sin publicar del caso **OP-025** (búsquedas sin límite) y `src/views/VentaRapidaView.jsx` del caso **OP-032** (comisión de cliente ajeno). Si se guardan, se llevan también esos cambios. **Resuelto en la carpeta de publicación (§7.0):** OP-025 quedó fuera y OP-032 ya estaba publicado.
- La carpeta de trabajo tiene además otros cambios sin publicar de otros casos (inicio de sesión, reportes de vendedores, etc.). **No** forman parte de este caso.
- `api/handlers/__tests__/cobrosIdempotencia.test.js` se actualizó, pero ese archivo está excluido de GitHub desde antes (solo vive en esta PC).

## 8. Qué queda pendiente o sin verificar

- Publicado (§10). Faltan las pruebas en pantalla de administración con operaciones reales (§4.3).
- Las pruebas en navegador real de staging (OP-049 a OP-057) se hicieron con el código de staging, no con esta versión de producción. Lo de producción se verificó con las 1.230 pruebas automáticas, la construcción y el ensayo de base de datos en staging. No se levantó la app de producción en un navegador.
- Las 3 fallas nuevas de staging (N16, N17, N18) siguen abiertas **en staging**. Arreglarlas allá es un trabajo aparte.
- Correcciones de datos D1 a D5: esperan tu decisión.

## 9. Lista de verificación para ti

- [ ] Leí el "En resumen" y entiendo que reabrir y anular ahora piden decisiones.
- [ ] Apruebo el paso a producción (sí / no / más adelante) y elijo el horario.
- [ ] Apruebo hacer el respaldo de producción justo antes.
- [x] Código separado y listo en la carpeta de publicación, sin OP-025 (§7.0).
- [ ] Aviso a administración y logística de los cambios en pantalla (§4.3).
- [ ] Decido sobre cada corrección de datos D1 a D5 (por separado).
- [ ] **Borro la llave `sbp_…`:** entrar a supabase.com → mi cuenta (arriba a la derecha) → *Access Tokens* → buscar la llave que se pegó en el chat → *Revoke* (eliminar). Si no sabes cuál es, se pueden eliminar todas y crear una nueva cuando haga falta.

## 10. Publicación en producción (2026-11-24)

**En resumen:** publicado con tu aprobación ("Sí, publica"). Primero la base de datos, después el código, como dice §2. Todo salió bien y nada de lo que existía cambió.

| Paso | Qué se hizo | Resultado |
|---|---|---|
| 0 | **Respaldo.** Supabase hace copias diarias; la última era del 23-nov. Además, a las 11:40 (hora UTC) se sacó una copia propia: las 236 funciones de la base, las 5 vistas, la lista de categorías y las tablas `cuentas_por_cobrar` (1.050), `clientes` (1.284), `notas_despacho` (2.827) y `comisiones` (1.765) | En `Desktop\respaldo-OP-2026-059-20261124-072047\base_produccion` (fuera del proyecto: tiene datos de clientes) |
| — | Antes de aplicar se comprobó que producción no había cambiado desde la preparación | 19 de 19 funciones idénticas a las estudiadas |
| 1-9 | Migraciones 301 a 309 aplicadas una por una con [`aplicar_migraciones_prod.py`](OP-2026-059_scripts/aplicar_migraciones_prod.py) | Las 9 sin errores |
| 10 | Revisión de la base (§4.1) | Suma de deudas **$73.688,22** y de saldos a favor **$674,15**: iguales al centavo antes y después. La auditoría tiene 14 categorías. Columna `idempotency_key`, tabla `cxc_movimientos_borrados` y su disparador: presentes. Las 12 funciones revisadas solo las puede usar el servidor |
| 11 | Código: [solicitud #66](https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/66), unida a `main` (commit `5a323d22`) | Worker publicado en Cloudflare (verde). Vercel publicado (verde) |
| 12 | Pruebas del servidor (§4.2) | La app y `/api/ping` responden 200. Las 3 rutas nuevas responden 401 sin sesión (antes de publicar daban 404). La pantalla publicada ya trae el código nuevo. Sin errores en la auditoría ni cambios de saldos en los primeros minutos |

Notas:
- El revisor automático "Kilo Code Review" marca fallo en 1 segundo en todas las solicitudes, incluidas las anteriores (#64). No tiene que ver con este cambio.
- La tabla de historial de migraciones de Supabase no se usa en este proyecto (solo tiene 2 filas antiguas), así que no se anotó ahí. El registro oficial es [matriz-migraciones.md](matriz-migraciones.md).
- **Cómo deshacer:** ver §3. Para el código, en Vercel "Instant Rollback" y en Cloudflare `wrangler rollback`. Para la base, las reversas en orden inverso (309 → 301).

**Pendiente:**
- Pruebas en pantalla de administración con operaciones reales del día (§4.3).
- Correcciones de datos D1 a D5 y [OP-2026-060](OP-2026-060_pagos-no-registrados-propuesta.md) (los 4 pagos no registrados). Cada una necesita su aprobación.
- Borrar la llave `sbp_…` en supabase.com. Ojo: los guiones de Claude usan esa llave para leer producción. Al borrarla, para futuras revisiones hará falta crear una nueva y ponerla en el archivo `.env` de tu PC (nunca en el chat).
