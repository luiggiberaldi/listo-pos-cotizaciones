# OP-2026-066 — Plan: Auditoría 2.0 (más completa, más rápida y que crece sola)

**Fecha:** 2026-11-24 · **Estado:** 📝 propuesta, sin aprobar, nada aplicado · **Origen:** [OP-2026-065](../operaciones/OP-2026-065_auditoria-que-no-registra.md)

## En resumen

- **Hoy la auditoría depende de que el programador "se acuerde"** de escribir una anotación en cada botón. Cuando se olvida, se equivoca de etiqueta o el servidor no espera, la acción se pierde sin aviso (OP-065: inicios de sesión perdidos desde agosto, cotizaciones y vehículos que nunca se anotaron).
- **La propuesta: tres capas, como en un edificio con seguridad.**
  1. **Cámaras en la base de datos:** cada cambio en las tablas importantes (despachos, pagos, clientes, inventario, precios, usuarios) se graba solo, con **el antes y el después**. No depende de nadie.
  2. **Portero en la entrada del servidor:** cada operación que cambia algo (guardar, editar, borrar) queda anotada automáticamente, aunque sea una pantalla nueva que nadie conectó a la auditoría.
  3. **Bitácora del negocio:** la anotación "en palabras" que ya existe ("Juan registró un abono de $50"), ahora sin pérdidas y con una lista única de acciones.
- **Crece sola con los cambios:** si mañana se crea una tabla o una pantalla nueva, queda vigilada sin hacer nada. Y si alguien la deja fuera, una **revisión automática** frena la publicación y avisa.
- **Además:** nadie (ni siquiera el jefe) podrá borrar ni editar la auditoría. Hoy el rol "jefe" **sí puede borrarla o modificarla**. También habrá un chequeo diario que avise si algo dejó de anotarse.

## Qué se encontró hoy (punto de partida)

| Tema | Hoy |
|---|---|
| Dónde se anota | 1 tabla (`auditoria`, ~26.000 filas, 11 MB). Se escribe desde 60+ lugares del servidor y 16 funciones de la base. |
| Qué captura | Solo lo que el programador escribió a mano. **No guarda el antes/después** de los cambios. |
| Categorías | Lista cerrada en la base. Una etiqueta nueva no prevista → la anotación se rechazaba (devoluciones, descuentos, configuración perdidas hasta el 24-nov). |
| Fiabilidad | Varias anotaciones se mandan "sin esperar" y se pierden (OP-065). La alarma de fallos también se pierde. |
| Seguridad del registro | El rol `jefe` tiene permiso total sobre la tabla (política `auditoria_jefe_all`): **puede borrar o cambiar anotaciones**. |
| Cobertura | De ~43 tablas, ninguna se graba sola. Tablas con dinero (pagos a transportistas, cuentas por pagar, comisiones, precios) dependen de anotaciones manuales que en varios casos no existen. |

## La propuesta en detalle

### Capa 1 — "Cámaras" en la base de datos (captura automática)

- Un **disparador** (una regla de la base que se ejecuta sola cada vez que algo cambia) en cada tabla importante. Graba en una tabla nueva `auditoria_cambios`: tabla, fila, tipo (creado / editado / borrado), **solo los campos que cambiaron con su valor anterior y nuevo**, quién, cuándo y desde qué operación.
- **Quién lo hizo:** el servidor ya sabe qué operador está conectado. Lo pasará a la base en cada operación, y la base lo pega al cambio. Si un cambio llega sin operador (un arreglo manual, un proceso nocturno), queda marcado como "sistema" o "manual". Eso también es útil: muestra los cambios hechos por fuera de la aplicación.
- **No se puede perder:** se guarda en el mismo paso que el cambio. Si el cambio se guarda, su grabación también; si falla uno, fallan los dos.
- **Tablas iniciales:** `notas_despacho`, `notas_despacho_items`, `cotizaciones`, `cuentas_por_cobrar` y sus movimientos, `clientes`, `productos` y precios, `inventario_movimientos`, `comisiones`, `usuarios`, `transportistas`, `pagos_transportistas`, `vehiculos`, `cuentas_por_pagar`, `proveedores`, `configuracion_negocio`, `despacho_devoluciones`, `despacho_descuentos`.
- **Se excluyen** tablas de mucho movimiento y poco valor (sesiones, avisos del sistema, suscripciones de notificaciones) para no llenar la base de ruido.

### Capa 2 — "Portero" en el servidor (cada operación queda anotada)

- En la puerta de entrada del servidor (el punto por donde pasan todas las peticiones), cada operación que cambia algo deja una línea: quién, qué ruta, resultado (bien / error / sin permiso), duración y un **número de operación**.
- Ese número une las tres capas: desde una línea se ven todos los cambios de la base que produjo y su anotación del negocio.
- Como está en la puerta, **cualquier pantalla nueva queda cubierta sin tocar nada**. También deja rastro de los intentos sin permiso y de los errores, que hoy no se ven.
- El servidor le pide a Cloudflare **"no apagues hasta terminar de guardar"** (`waitUntil`): la anotación no hace más lento al usuario y no se pierde.

### Capa 3 — Bitácora del negocio (lo que ya existe, mejorado)

- Se mantiene `registrarAuditoria` para las frases legibles ("Ana anuló el despacho 2741 y devolvió $120 al cliente").
- **Lista única de acciones** (`auditoria_catalogo`): cada acción con su categoría, una descripción en español y su nivel de importancia (normal / sensible / crítica). Reemplaza la lista cerrada de categorías: **una acción nueva no se rechaza**, se guarda y queda marcada "sin catalogar" para revisarla.
- Todas las anotaciones se envían esperando o con `waitUntil`. Nunca "sin esperar".
- La alarma de fallos se arregla (OP-065, punto 2) y además se reintenta una vez antes de rendirse.

### Que evolucione sola con los cambios

| Mecanismo | Qué hace | Analogía |
|---|---|---|
| **Cámara automática para tablas nuevas** | Una regla de la base que, cuando se crea una tabla nueva, le instala la "cámara" sola (salvo que esté en la lista de excluidas). | Cada habitación nueva del edificio viene con cámara de fábrica. |
| **Revisión automática antes de publicar** (pruebas) | Si hay una tabla sin cámara y sin estar excluida, una acción usada en el código que no está en el catálogo, o una anotación enviada "sin esperar", la prueba falla y **no deja publicar** hasta corregirlo. | El inspector no firma la obra si falta una cámara. |
| **El portero cubre rutas nuevas** | Toda ruta nueva pasa por la puerta y queda anotada sin escribir nada. | Todo el que entra pasa por recepción. |
| **Campos nuevos incluidos** | La cámara graba "lo que cambió", sin una lista fija de campos: si se agrega una columna, sus cambios aparecen solos. | La cámara graba lo que haya en el cuarto, aunque cambien los muebles. |
| **Chequeo diario de salud** | Cada noche compara lo que pasó en el negocio (despachos, abonos, inicios de sesión, devoluciones) con lo anotado. Si una acción que antes aparecía deja de aparecer o no cuadra, envía un aviso. | El encargado revisa cada mañana que todas las cámaras sigan grabando. |
| **Regla en AGENTS.md** | Se agrega: "toda función nueva que cambie datos debe quedar en la auditoría; la prueba lo verifica". | El manual del edificio lo exige. |

### Que no se pueda alterar

- Quitar a todos los roles (incluido `jefe`) el permiso de **editar o borrar** la auditoría: solo agregar y leer.
- **Sello encadenado** (opcional): cada anotación guarda una huella de la anterior. Si alguien borrara o cambiara una línea por fuera de la aplicación, la cadena se rompe y el chequeo diario lo detecta.

### Más rápida y liviana

- Guardar solo los campos que cambiaron, no la fila entera.
- Índice por fecha adecuado para tablas que solo crecen (BRIN) y tabla separada por mes cuando pase de ~1 millón de filas, para que la pantalla siga rápida.
- Conservación: 2 años a mano; lo más viejo, a un archivo de respaldo (no se borra sin copia, igual que lo decidido en OP-062).
- Los contadores de la pantalla (hoy 5 consultas por apertura) pasan a un resumen precalculado.

### Pantalla de auditoría 2.0

- **Historia de cada cosa:** al abrir un despacho, cliente o producto, botón "Ver historia", con línea de tiempo y antes/después de cada cambio ("precio: $12,50 → $13,00, por Ana, 24-nov 10:32").
- **Filtros** por persona, fecha, tipo de cosa, importancia y "cambios hechos por fuera de la aplicación".
- **Alertas visibles:** acciones críticas (anular con pagos, borrar, cambiar precios en lote, inicios de sesión fallidos repetidos) resaltadas arriba.
- **Exportar** a Excel/PDF.

## Fases propuestas (todo primero en staging)

| Fase | Qué | Esfuerzo | Riesgo |
|---|---|---|---|
| **0** | Arreglo urgente de OP-065: anotaciones con `waitUntil`, alarma corregida, quitar al `jefe` el permiso de borrar/editar | Pequeño | Bajo |
| **1** | Cámaras en la base (tabla `auditoria_cambios`, disparadores en las tablas iniciales, operador pasado desde el servidor) | Medio | Medio: tocar tablas de dinero; se mide la velocidad antes y después |
| **2** | Portero en el servidor + número de operación + catálogo de acciones | Medio | Bajo |
| **3** | Crecer sola: cámara automática para tablas nuevas, pruebas que frenan la publicación, chequeo diario, regla en AGENTS.md | Pequeño-medio | Bajo |
| **4** | Pantalla 2.0: historia por cosa, antes/después, filtros, alertas, exportar | Medio | Bajo |
| **5** | Sello encadenado, resumen precalculado, archivo de lo viejo | Pequeño | Bajo |

Cada fase se prueba en staging, se documenta con su caso OP y se publica por separado. La fase 0 conviene hacerla ya; las demás pueden ir de a una.

## Qué tienes que decidir

1. ¿Apruebas el plan y el orden de fases?
2. ¿Cuánto tiempo guardar la auditoría a mano? (propuesta: 2 años, luego archivo)
3. ~~¿Quién puede ver la auditoría?~~ **Decidido por el dueño (2026-11-24): el supervisor NO ve los cambios de precios ni de dinero.** Los ven jefe y administrador. El supervisor conserva lo que ve hoy de la bitácora (sin antes/después de precios, pagos, abonos, comisiones ni cuentas).

## Riesgos y cómo se cuidan

- **Velocidad (pregunta del dueño, 2026-11-24):** el usuario no debería notar diferencia. Razones:
  - **Volumen bajo:** el sistema hace unas 100–150 acciones con cambios por día. Grabar el antes/después de una fila toma fracciones de milisegundo; una operación normal tarda hoy entre 300 y 1.500 ms, casi todo en ir y volver por internet.
  - **Lo más pesado** es la edición profunda de un despacho (cambia decenas de renglones a la vez). Se estima que agrega pocos milisegundos; es lo primero que se mide.
  - **El portero y la bitácora no hacen esperar al usuario:** se guardan en segundo plano con `waitUntil`. Hoy algunas anotaciones sí hacen esperar; eso mejora.
  - **La pantalla de auditoría se acelera:** pasa de 5 consultas por apertura a un resumen precalculado.
  - **Regla de seguridad:** en staging se mide cada operación clave (crear despacho, edición profunda, abono, devolución, ingreso de inventario) antes y después. Si alguna sube más de 50 ms, no se publica hasta ajustarla (grabar menos campos o sacar esa tabla de las cámaras).
- **Espacio:** guardar solo lo que cambia lo mantiene pequeño. Estimado: el doble o el triple de lo actual (hoy 11 MB), muy por debajo del límite.
- **Datos sensibles:** no se graban PIN ni claves (se excluyen por nombre de campo).
- **Producción:** nada se toca en producción sin aprobación, sin respaldo y sin haber pasado por staging.

## Pendiente / sin verificar

- No se midió la velocidad real con disparadores (se hará en la fase 1 en staging).
- Los contadores de filas por tabla vienen de las estadísticas de la base y pueden estar atrasados; no cambian la propuesta.
