# OP-2026-066 — Plan: Auditoría 2.0 (más completa, más rápida y que crece sola)

**Fecha original:** 2026-11-24 · **Actualizado:** 2026-11-28 (con hallazgos de [OP-2026-108](../operaciones/OP-2026-108_auditoria-plan-auditoria-2.md)) · **Estado:** ✅ **Publicado y verificado en producción** (Fases 0 a 5 completas: [OP-2026-109](../operaciones/OP-2026-109_auditoria-fase-0.md), [OP-2026-110](../operaciones/OP-2026-110_auditoria-2-completa-staging.md) y [OP-2026-111](../operaciones/OP-2026-111_paso-produccion-auditoria-2.md)) · **Origen:** [OP-2026-065](../operaciones/OP-2026-065_auditoria-que-no-registra.md)

## En resumen

- **Hoy la auditoría depende de que el programador "se acuerde"** de escribir una anotación en cada botón. Cuando se olvida, se equivoca de etiqueta o el servidor no espera, la acción se pierde sin aviso (OP-065: inicios de sesión perdidos desde agosto, pagos a transportistas y vehículos que nunca se anotaron; cotizaciones ya se arregló en OP-069).
- **La propuesta: tres capas, como en un edificio con seguridad.**
  1. **Cámaras en la base de datos:** cada cambio en las tablas importantes (despachos, pagos, clientes, inventario, precios, usuarios) se graba solo, con **el antes y el después**. No depende de nadie.
  2. **Portero en la entrada del servidor:** cada operación que cambia algo (guardar, editar, borrar) queda anotada automáticamente, aunque sea una pantalla nueva que nadie conectó a la auditoría.
  3. **Bitácora del negocio:** la anotación "en palabras" que ya existe ("Juan registró un abono de \$50"), ahora sin pérdidas y con una lista única de acciones.
- **Crece sola con los cambios:** si mañana se crea una tabla o una pantalla nueva, queda vigilada por el portero y una **revisión automática antes de publicar** (pruebas en código) frena la publicación y avisa si una tabla nueva quedó sin cámara. *(Nota OP-108: se quitó el "Event Trigger" dentro de la base porque Supabase no lo permite por seguridad).*
- **Además:** nadie (ni siquiera el jefe) podrá borrar ni editar la auditoría en producción — con doble protección (reglas de acceso + candado directo en la tabla). También se integra un chequeo diario en el Auditor nocturno existente.

## Qué se encontró (punto de partida actualizado al 27-nov)

| Tema | Situación antes de Fase 0 |
|---|---|
| Dónde se anota | 1 tabla (`auditoria`, ~26.000 filas, 11 MB). Se escribe desde 60+ lugares del servidor y 16 funciones de la base. |
| Qué captura | Solo lo que el programador escribió a mano. **No guarda el antes/después** de los cambios. |
| Categorías | Lista cerrada en la base (ampliada en migración 303 + rescate como `SISTEMA` en OP-050/059). |
| Fiabilidad | `waitUntil` solo estaba conectado en 4 rutas del servidor (`worker.js`). Cotizaciones ya se arregló (OP-069), pero inicios de sesión, transportistas, pagos a transportistas, vehículos y una vía de crear despacho seguían enviándose "sin esperar" y perdiéndose. La alarma de fallos también se perdía por usar un origen no aceptado (`auditoria` en vez de `worker`). |
| Seguridad del registro | El rol `jefe` tenía permiso total sobre la tabla (`auditoria_jefe_all`): **podía borrar o cambiar anotaciones**. Además faltaba candado directo en la tabla contra borrados/ediciones accidentales desde el servidor. |
| Permisos de lectura | El rol `administracion` estaba bloqueado en el servidor (`api/handlers/audit.js`) y en `useAuditoria.js` pese a tener el botón en el menú. El `supervisor` leía directo desde el navegador sin filtro de precios/dinero. |
| Cobertura | De ~43 tablas, ninguna se graba sola. Tablas con dinero (pagos a transportistas, cuentas por pagar, comisiones, precios) dependen de anotaciones manuales. |

## La propuesta en detalle

### Capa 1 — "Cámaras" en la base de datos (captura automática)

- Un **disparador** (una regla de la base que se ejecuta sola cada vez que algo cambia) en cada tabla importante. Graba en una tabla nueva `auditoria_cambios`: tabla, fila, tipo (creado / editado / borrado), **solo los campos que cambiaron con su valor anterior y nuevo**, quién, cuándo y desde qué operación.
- **Cómo sabe la base quién lo hizo (ajustado por OP-108):** como el servidor habla con Supabase por llamadas web independientes (PostgREST), se usará un generador único de cabeceras en el servidor que enviará `x-operator-id`, `x-operator-nombre` y `x-request-id` en cada operación. La cámara leerá esos encabezados **solo cuando la llamada venga con la llave del servidor (`service_role`)**, nunca desde el navegador, para evitar suplantación. Si un cambio llega sin operador (proceso nocturno o arreglo manual), queda marcado como `sistema (cron)` o `manual`.
- **Compatibilidad con respaldos y pruebas (ajustado por OP-108):** la función de restauración atómica de 26 tablas (`318_prod_respaldo_restauracion_atomica_26_tablas.sql`) y las limpiezas de pruebas en staging usarán una bandera interna de sesión (`app.skip_audit_triggers = '1'`, solo permitida para funciones privilegiadas) para pausar las cámaras durante una restauración masiva y dejar una sola anotación resumida (*"RESPALDO RESTAURADO"*).
- **No se puede perder:** se guarda en el mismo paso que el cambio. Si el cambio se guarda, su grabación también; si falla uno, fallan los dos.
- **Tablas iniciales:** `notas_despacho`, `notas_despacho_items`, `cotizaciones`, `cuentas_por_cobrar`, `clientes`, `productos`, `inventario_movimientos`, `comisiones`, `usuarios`, `transportistas`, `pagos_transportistas`, `vehiculos`, `cuentas_por_pagar`, `proveedores`, `configuracion_negocio`, `despacho_devoluciones`, `despacho_descuentos`.
- **Se excluyen** tablas de mucho movimiento y poco valor (sesiones, avisos del sistema, suscripciones de notificaciones) para no llenar la base de ruido.

### Capa 2 — "Portero" en el servidor (cada operación queda anotada)

- En la puerta de entrada del servidor (`worker.js`), cada operación que cambia algo deja una línea: quién, qué ruta, resultado (bien / error / sin permiso), duración y un **número de operación** (`request_id`).
- Ese número une las tres capas: desde una línea se ven todos los cambios de la base que produjo y su anotación del negocio.
- Como está en la puerta, **cualquier pantalla nueva queda cubierta sin tocar nada**. También deja rastro de los intentos sin permiso y de los errores, que hoy no se ven.
- `conWaitUntil(env, ctx)` queda conectado **en la entrada de todo `/api/`**: las anotaciones no hacen más lento al usuario y no se pierden.

### Capa 3 — Bitácora del negocio (lo que ya existe, mejorado)

- Se mantiene `registrarAuditoria` para las frases legibles ("Ana anuló el despacho 2741 y devolvió \$120 al cliente").
- **Lista única de acciones** (`auditoria_catalogo`): cada acción con su categoría, una descripción en español y su nivel de importancia (normal / sensible / crítica). Reemplaza la lista cerrada de categorías: **una acción nueva no se rechaza**, se guarda y queda marcada "sin catalogar" para revisarla.
- Todas las anotaciones se envían esperando o con `waitUntil`. Nunca "sin esperar".
- La alarma de fallos usa `origen: 'worker'` (aceptado por `system_logs`) con `suborigen: 'auditoria'` en `meta`, y se reintenta antes de rendirse.

### Que evolucione sola con los cambios (ajustado por OP-108)

| Mecanismo | Qué hace | Analogía |
|---|---|---|
| **Revisión automática antes de publicar** (pruebas en CI) | Revisa todas las tablas de `supabase/migrations/`: si hay una tabla nueva sin cámara y sin estar en la lista de excluidas, una acción usada en el código que no está en el catálogo, o una anotación enviada "sin esperar", la prueba falla y **no deja publicar** hasta corregirlo. *(Reemplaza el Event Trigger en BD, que Supabase no permite).* | El inspector no firma la obra si falta una cámara. |
| **El portero cubre rutas nuevas** | Toda ruta nueva pasa por la puerta de `worker.js` y queda anotada sin escribir nada. | Todo el que entra pasa por recepción. |
| **Campos nuevos incluidos** | La cámara graba "lo que cambió", sin una lista fija de campos: si se agrega una columna, sus cambios aparecen solos. | La cámara graba lo que haya en el cuarto, aunque cambien los muebles. |
| **Chequeo diario de salud (integrado en el Auditor de las 2:00 a. m.)** | Se agrega al **Auditor de saldos y comisiones en producción** (`scripts/auditor-saldos-main.mjs`) para comparar lo que pasó en el negocio con lo anotado y avisar si algo dejó de registrarse. | El encargado revisa cada mañana que todas las cámaras sigan grabando. |
| **Regla en AGENTS.md** | Se agrega: "toda función nueva que cambie datos debe quedar en la auditoría; la prueba lo verifica". | El manual del edificio lo exige. |

### Que no se pueda alterar (ajustado por OP-108)

- **Doble candado en Fase 0:**
  1. Quitar a `jefe` el permiso `FOR ALL` (`auditoria_jefe_all`) y reemplazarlo por solo lectura (`SELECT`), igual que administración y supervisor.
  2. Agregar un **candado directo en la tabla** (`BEFORE UPDATE OR DELETE` trigger en `public.auditoria`) que impide editar o borrar filas incluso desde el servidor, salvo cuando una limpieza explícita de entorno de pruebas activa la bandera controlada `app.permitir_limpieza_auditoria = '1'`.
- **Sello encadenado** (opcional, Fase 5): cada anotación guarda una huella de la anterior.

### Más rápida, liviana y bien respaldada (ajustado por OP-108)

- Guardar solo los campos que cambiaron, no la fila entera.
- Índice por fecha adecuado para tablas que solo crecen (BRIN) y tabla separada por mes cuando pase de ~1 millón de filas.
- Conservación: 2 años a mano; lo más viejo, a un archivo de respaldo (no se borra sin copia, igual que OP-062).
- **Respaldos:** dejar claro que el respaldo completo de `auditoria` y `auditoria_cambios` vive en el respaldo semanal a Google Drive (OP-2026-028), mientras el respaldo rápido de la app mantiene un recorte seguro de las filas recientes.
- Los contadores de la pantalla (hoy 5 consultas por apertura) pasan a un resumen precalculado.

### Pantalla de auditoría 2.0 y separación real de roles (ajustado por OP-108)

- **Lectura centralizada por el servidor:** la pantalla deja de consultar la tabla `auditoria` directo desde el navegador y pasa por `/api/admin/audit` (donde el servidor filtra de forma real lo que puede ver cada rol).
- **Permisos confirmados:** `jefe`, `administracion` y `desarrollador` ven todo (incluyendo cambios de precios y dinero). `supervisor` conserva la bitácora operativa pero **sin** antes/después de precios, pagos, abonos, comisiones ni cuentas.
- **Historia de cada cosa:** al abrir un despacho, cliente o producto, botón "Ver historia", con línea de tiempo y antes/después de cada cambio.
- **Filtros** por persona, fecha, tipo de cosa, importancia y "cambios hechos por fuera de la aplicación".
- **Alertas visibles:** acciones críticas resaltadas arriba.
- **Exportar** a Excel/PDF.

## Fases propuestas (todo primero en staging)

| Fase | Qué | Esfuerzo | Riesgo | Estado |
|---|---|---|---|---|
| **0** | Arreglo urgente de OP-065 + correcciones OP-108: `waitUntil` global en `/api/`, pasar todas las llamadas sueltas a `waitUntil`, alarma corregida (`origen: 'worker'`), habilitar `administracion` en lectura de auditoría, quitar `auditoria_jefe_all` + candado real `BEFORE UPDATE/DELETE` | Pequeño | Bajo | 🟡 En ejecución (OP-2026-109) |
| **1** | Cámaras en la base (`auditoria_cambios`, disparadores con validación `service_role`, encabezados estándar en servidor, pausa controlada para restauración de 26 tablas y limpiezas staging, medición de velocidad) | Medio | Medio | Pendiente |
| **2** | Portero en el servidor + número de operación + catálogo de acciones | Medio | Bajo | Pendiente |
| **3** | Crecer sola: pruebas en CI que frenan la publicación si falta cámara/catálogo/waitUntil, chequeo diario integrado en el Auditor de las 2:00 a. m., regla en AGENTS.md | Pequeño-medio | Bajo | Pendiente |
| **4** | Pantalla 2.0: lectura 100 % por servidor con filtro real para supervisor, historia por cosa, antes/después, filtros, alertas, exportar | Medio | Bajo | Pendiente |
| **5** | Sello encadenado, resumen precalculado, archivo de lo viejo | Pequeño | Bajo | Pendiente |

## Impacto en probadores e inspectores automáticos (regla OP-2026-105)

- **Auditor de saldos y comisiones en producción (2:00 a. m., `auditor-saldos-main.yml`):** se respeta su consulta actual (`W4_reversiones_sin_auditoria`) y en Fase 3 se integra ahí el chequeo diario de salud de la auditoría.
- **Probador nocturno en staging (1:00 a. m., `staging-e2e-nightly.yml`) y Verificador diario en staging (12:00 a. m. L–S, `verificador-diario-staging.yml`):** en Fase 0 y Fase 1 se mantiene compatibilidad con sus limpiezas en staging y se verifica que la latencia no supere +50 ms por operación.
- **Limpieza nocturna del servidor (`wrangler.toml`):** en Fase 1 sus cambios quedan etiquetados como `sistema (cron)`.
- **Pruebas automáticas (`vitest`):** se amplían con pruebas específicas para `waitUntil`, alarma corregida, permiso de `administracion` y cobertura de auditoría.

## Qué tienes que decidir

1. ~~¿Apruebas el plan y el orden de fases?~~ **Fase 0 aprobada (2026-11-27)**; Fases 1–5 se aprueban una por una.
2. ¿Cuánto tiempo guardar la auditoría a mano? (propuesta: 2 años, luego archivo — pendiente de confirmar antes de Fase 5).
3. ~~¿Quién puede ver la auditoría?~~ **Decidido por el dueño (2026-11-24):** el supervisor NO ve los cambios de precios ni de dinero. Los ven jefe y administrador.

## Riesgos y cómo se cuidan

- **Velocidad:** límite máximo +50 ms por operación clave en staging antes de publicar Fase 1. Fase 0 incluso mejora o mantiene velocidad porque usa `waitUntil` en segundo plano.
- **Datos sensibles:** no se graban PIN ni claves (se excluyen por nombre de campo).
- **Producción:** nada se toca en producción sin aprobación, sin respaldo y sin haber pasado por staging.
