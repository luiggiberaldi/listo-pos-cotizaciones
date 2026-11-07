# Plan de optimización de velocidad — Supabase Pro

**Fecha:** 6 de noviembre de 2026 · **Proyecto:** producción (`listopos cotización`) · **Estado:** Fase 2 aplicada; el resto, propuesta

---

## En resumen

- La base de datos es **pequeña (54 MB)** y con el servidor Micro de Pro **cabe completa en memoria**. El servidor no es el problema y **no hace falta pagar más**.
- La lentitud que se pueda sentir viene de **cómo está armado el sistema**: reglas de permisos que trabajan de más, índices que faltan, fotos que pesan más de lo necesario en las listas y pantallas que piden más datos de los que muestran.
- El plan tiene **6 fases**, ordenadas de **más segura a más delicada**. Cada fase se puede deshacer y ninguna se aplica a producción sin respaldo previo y sin tu visto bueno.
- **Costo extra estimado:** $0 a ~$5 al mes. Lo único que podría costar es la función de fotos livianas (Fase 3).

| Fase | Qué se hace | Mejora esperada | Riesgo | Dónde se prueba |
|---|---|---|---|---|
| 1 | Medir cómo está hoy | — (sirve para comparar) | Ninguno | Producción, solo lectura |
| 2 | Agregar 39 índices y quitar 1 repetido | Media | Muy bajo | Directo en producción |
| 3 | Fotos en miniatura en las listas | Alta en teléfonos | Bajo | Entorno de pruebas → producción |
| 4 | Simplificar las reglas de permisos | **La más alta** | **Medio** | Entorno de pruebas obligatorio |
| 5 | Pantallas que piden solo lo que muestran | Media | Bajo | Entorno de pruebas → producción |
| 6 | Limpieza y vigilancia continua | Mantener lo ganado | Muy bajo | Producción |

---

## Lo que encontramos (diagnóstico)

Revisión hecha en modo **solo lectura** el 6/11/2026 con las herramientas de diagnóstico de Supabase y revisando el código.

| Hallazgo | Cantidad | Explicación sencilla |
|---|---|---|
| Reglas de permisos que se repiten **fila por fila** | 52 | Es como un portero que pide la cédula **por cada caja** que sale del almacén, en vez de una sola vez por persona. Afecta despachos, productos, clientes y cotizaciones. |
| Reglas de permisos **duplicadas** para la misma acción | 242 | Hay varias reglas que dicen casi lo mismo (por ejemplo, 6 reglas distintas para "ver clientes"), y la base las revisa **todas** cada vez. |
| Relaciones entre tablas **sin índice** | 39 | Un índice es como el índice de un libro. Sin él, para encontrar "las devoluciones de este despacho" la base hojea todas las páginas. |
| Índice **repetido** | 1 | `notas_despacho` tiene dos índices idénticos por cliente. Uno sobra y hace un poco más lento guardar. |
| Índices que **nadie usa** | 97 | Ocupan espacio y frenan un poco al guardar. **No se tocan todavía**: las estadísticas se reiniciaron al pasar a Micro y hay que esperar un mes de uso para saber cuáles sobran de verdad. |
| Pantallas que piden **todas las columnas** | 68 lugares en el código | Es como pedir el expediente completo de cada cliente cuando la lista solo muestra nombre y teléfono. |
| Fotos de productos | 685 fotos, ~100 KB c/u | Ya se comprimen al subirlas (800 px, formato WebP, bien hecho), pero en las **listas** se muestra la foto completa aunque se vea pequeñita. |

**Lo que está bien y no hay que tocar:**
- La base completa (54 MB) cabe en la memoria del servidor (256 MB).
- La app ya guarda en memoria temporal (caché) muchas consultas para no repetirlas (51 lugares).
- Las fotos ya se comprimen al subirlas.

**Lo que NO recomendamos (aunque Pro lo ofrezca):**

| Opción | Por qué no |
|---|---|
| Servidor más grande (Small, Medium…) | La base cabe entera en memoria. Pagar más no aceleraría nada. |
| Réplicas de lectura (copias extra para repartir la carga) | Son para miles de usuarios a la vez. Ustedes son ~13. |
| Mover la base a una región más cercana (hoy está en Oregón, EE. UU.) | Obliga a crear un proyecto nuevo y migrar todo, que es justo el riesgo de "clonar" que evitamos. La ganancia (unos 50–80 milisegundos por consulta) no lo justifica. |

---

## Fase 1 — Medir cómo está hoy (línea base)

**Qué es:** antes de arreglar, anotar cuánto tardan hoy las cosas, para poder demostrar después que mejoró. Es como pesarse antes de empezar una dieta.

**Pasos:**
1. Dejar **una semana de uso normal** (las estadísticas se reiniciaron al pasar a Micro).
2. Sacar de producción, en modo solo lectura, la lista de **las 20 consultas que más tiempo consumen** en total y cuál pantalla las origina.
3. Medir en el navegador cuánto tardan en abrir las 5 pantallas más usadas: Despachos, Cotizaciones, Clientes, Productos/catálogo y Cuentas por cobrar.
4. Guardar los números en este documento (sección "Resultados").

**Riesgo:** ninguno, solo lectura. **Tu parte:** usar el sistema normal esa semana.

---

## Fase 2 — Índices que faltan

**Qué es:** agregar los 39 "índices de libro" que faltan y quitar el repetido.

**Pasos:**
1. Respaldo previo (el script de respaldo que ya usamos).
2. Crear cada índice con el modo **"sin bloquear"** (`CONCURRENTLY`), así el sistema sigue funcionando normal mientras se crean. Con este tamaño de base tarda segundos.
3. Quitar `idx_notas_despacho_cliente` (es idéntico a `idx_nd_cliente_id`).
4. Volver a correr el diagnóstico de Supabase: la alerta de "relaciones sin índice" debe quedar en 0.

**Tablas que reciben índices:** devoluciones de despacho (4), préstamos a clientes (3), descuentos de despacho (3), transportistas (3), y de 1 a 2 cada una: comisiones, cotizaciones, despachos y sus ítems, pagos a transportistas, reasignaciones de clientes, cuentas por cobrar y por pagar, inventario, usuarios, seguimiento y notificaciones.

**Riesgo:** muy bajo. Un índice no cambia **ningún** resultado, solo la rapidez. **Cómo se deshace:** se borra el índice y queda todo como antes.
**Horario:** de noche o fin de semana.

---

## Fase 3 — Fotos livianas en las listas (función de Pro)

**Qué es:** Pro incluye **transformación de imágenes**: Supabase entrega la foto ya achicada al tamaño en que se va a ver. En una lista de productos, en vez de bajar 685 fotos de ~100 KB, el teléfono baja miniaturas de ~5–15 KB. Es **la mejora más visible para los vendedores en la calle** con datos móviles.

**Pasos:**
1. En la app, cambiar cómo se pide la foto: miniatura (~200 px) en listas y catálogo, y foto completa solo al abrir el detalle del producto.
2. Si la miniatura falla, mostrar la foto original (nunca una imagen rota).
3. Probar en el entorno de pruebas y comparar el peso descargado antes y después.
4. Publicar en producción.

**Costo:** Pro incluye un cupo de imágenes transformadas al mes. Con 685 fotos podría pasarse un poco: estimamos **$0 a ~$5 al mes**. **Antes de publicar se confirma el precio exacto en el panel de Supabase.** Si no te convence, se desactiva y vuelve a como estaba.
**Riesgo:** bajo, porque solo cambia cómo se muestran las fotos.

---

## Fase 4 — Simplificar las reglas de permisos (la de mayor impacto)

**Qué es:** las reglas que deciden "quién puede ver o cambiar qué" (vendedor solo sus clientes, administrador todo, etc.). Hay dos arreglos:

- **A. Preguntar una sola vez** (52 reglas): reescribir la regla para que pregunte "¿quién es este usuario y qué rol tiene?" **una vez por consulta** y no una vez por fila. No cambia **quién** ve qué, solo **cuántas veces** se pregunta.
- **B. Unificar reglas duplicadas** (242 casos en 16 tablas): por ejemplo, juntar las 6 reglas de "ver clientes" (jefe, administrador, logística, personal, supervisor, vendedor) en **una sola** regla equivalente.

**Por qué es la más delicada:** si una regla queda mal escrita, **un vendedor podría dejar de ver sus clientes, o ver los de otro**. Por eso tiene las protecciones más fuertes:

1. **Primero se hace la parte A**, que es mecánica y no cambia la lógica.
2. Antes de tocar nada, se arma una **prueba por cada rol**: con un usuario de prueba de cada tipo se anota exactamente **qué filas ve y qué puede hacer** en cada tabla. Esa es la "foto del antes".
3. Se aplican los cambios en un **entorno de pruebas** con copia de los datos.
4. Se repite la prueba: la "foto del después" debe ser **idéntica** a la del antes. Si cambia una sola fila, no se publica.
5. Recién entonces, producción, con respaldo previo, en horario tranquilo, **una tabla a la vez**, empezando por las más usadas: despachos, cotizaciones, clientes, productos y cuentas por cobrar.
6. Se guarda el "cómo deshacerlo" de cada tabla antes de aplicar.

**Necesitamos de ti:** acceso a un entorno de pruebas. El staging de construacero quedó en otra organización que el conector no ve. Opciones:
- (a) darle acceso al conector a esa organización (sin costo), o
- (b) crear un proyecto de pruebas **temporal** en la organización Pro (unos $0.32 por día mientras exista; se borra al terminar).

**Nota:** esta fase conviene combinarla con la revisión de seguridad pendiente (3 vistas que se saltan permisos y 35 funciones que se pueden llamar sin iniciar sesión), porque se trabaja sobre las mismas reglas y se prueba con las mismas pruebas por rol.

---

## Fase 5 — Pantallas que piden solo lo que muestran

**Qué es:** en 68 lugares la app pide "todas las columnas" de una tabla. En las listas grandes (despachos, cotizaciones, clientes) se cambia a pedir **solo las columnas que se muestran**, y paginar donde haga falta (mostrar de 50 en 50).

**Pasos:**
1. Empezar por las pantallas que la Fase 1 muestre como más lentas, no por las 68 a la vez.
2. Cada cambio con su prueba automática y revisión en el navegador.
3. Publicar de a poco.

**Riesgo:** bajo. El peligro típico es que una pantalla deje de mostrar un dato porque no se pidió esa columna. Se evita probando cada pantalla tocada.

---

## Fase 6 — Limpieza y vigilancia continua

1. **Al mes de uso con Micro:** revisar los 97 índices sin uso. Solo se borran los que sigan con **cero usos** y no protejan reglas de "no repetir" (por ejemplo, que no haya dos despachos con el mismo número).
2. **Mensual:** correr el diagnóstico de Supabase (rendimiento y seguridad) y anotar si aparecen alertas nuevas. Se puede sumar a la tarea automática de los sábados.
3. **Panel de Supabase → Reports:** revisar una vez al mes que el uso de memoria y procesador esté holgado. Si alguna vez pasa del 70% de forma sostenida, recién ahí evaluar un servidor más grande.

---

## Orden y tiempos sugeridos

| Semana | Qué pasa | Tu parte |
|---|---|---|
| 1 | Fase 1 (medir) + Fase 2 (índices, una noche) | Usar el sistema normal; aprobar la noche de índices |
| 2 | Fase 3 (fotos) | Probar el catálogo en tu teléfono |
| 2–3 | Preparar entorno de pruebas y pruebas por rol | Elegir opción (a) o (b) de la Fase 4 |
| 3–4 | Fase 4 (permisos), tabla por tabla | Aprobar cada publicación |
| 4–5 | Fase 5 (pantallas más lentas) | Revisar las pantallas cambiadas |
| Mes 2 | Fase 6 (limpieza de índices) y medición final | — |

## Reglas que se cumplen en todas las fases

- **Respaldo antes de cada cambio en producción** (además de las copias diarias de Supabase y la semanal de los sábados).
- **Nada se publica en producción sin tu aprobación.**
- **Horario tranquilo** (noche o fin de semana) para todo cambio en producción.
- **Cada cambio tiene su forma de deshacerlo**, escrita antes de aplicarlo.
- **Se mide antes y después**, para saber si de verdad mejoró.

---

## Resultados

*(Se completa a medida que avanzan las fases.)*

### Fase 2 — ✅ Aplicada en producción (6/11/2026, ~10:45 p. m. hora de Venezuela)

- **Respaldo previo:** `construacero-backups/semanal-2026-11-07-02-40` (90 tablas, 68.597 filas, 694 archivos; verificado OK).
- **39 índices creados** sin bloquear el sistema (cada uno tardó menos de 1 segundo). Ninguno quedó inválido.
- **1 índice repetido quitado:** `idx_notas_despacho_cliente` (se conservó su gemelo `idx_nd_cliente_id`).
- **Verificación con el diagnóstico de Supabase:** "relaciones sin índice" pasó de **39 → 0** y "índice repetido" de **1 → 0**.
- **Registro del cambio:** `supabase/migrations/300_indices_relaciones_fase2.sql`. **Cómo deshacerlo:** `300_indices_relaciones_fase2_rollback.sql`.
- Los índices nuevos figuran por ahora como "sin uso" en el diagnóstico: es normal, se empiezan a usar a medida que se consultan esas tablas.

| Pantalla | Antes | Después |
|---|---|---|
| Despachos | — | — |
| Cotizaciones | — | — |
| Clientes | — | — |
| Productos / catálogo | — | — |
| Cuentas por cobrar | — | — |

### Fase 3 — ✅ Miniaturas listas en producción (código sin publicar todavía)

- **Cómo se hizo (gratis):** miniaturas propias de 240 px guardadas en `productos/thumbs/`, sin usar el servicio de transformación de imágenes de Supabase (que sí cobra).
- **Corrección al diagnóstico:** las fotos reales **no** eran WebP livianas de ~100 KB. Hay 510 JPEG (160 sueltas de ~340 KB y 350 en la subcarpeta `productos/` de ~42 KB), 6 PNG y 169 WebP, de los cuales 115 son archivos basura de 28 bytes.
- **Resultado medido:** 569 miniaturas creadas (promedio 2,7 KB). Las 356 fotos distintas que usan los productos pesaban **37 MB** y sus miniaturas pesan **0,8 MB** (≈ 98 % menos). Las 685 originales quedaron intactas.
- **Código (sin publicar):** `src/utils/imagenMiniatura.js`, `src/components/inventario/ImgProducto.jsx`, 5 pantallas de lista cambiadas, y subida automática de miniatura para fotos nuevas (`imageCompress.js`). 5 pruebas automáticas pasan y la compilación funciona. La "red de seguridad" (si falla la miniatura, se muestra la grande) se comprobó en un navegador real.
- **Pendiente de publicar:** el código nuevo aún no está en producción; mientras tanto la app sigue mostrando las fotos grandes como siempre.
- **Hallazgo aparte:** el producto `CON0929008` (UNION CONDUIT 1") apunta a un archivo basura de 28 bytes, así que su foto nunca se ve. Sin relación con este cambio; conviene resubirle la foto.
- **Cómo deshacer:** borrar la carpeta `productos/thumbs/` y revertir el código. Las fotos originales nunca se modificaron.
- **Script:** `scripts/generar-miniaturas-productos.mjs` (con `--subir` sube; sin él, prueba local).

### Relacionado — Etapa 2 del plan de 2/11 (7/11/2026)

- Publicado en producción (PR #35 y #36): búsqueda de clientes sin volver a descargar la lista (la lista carga 443 → 280 ms) y verificación de cada llamada en paralelo (376 → 205 ms en staging), más un cronómetro del servidor (`Server-Timing`).
- Cubre en parte la **Fase 5** de este plan para la pantalla de Clientes (sin cambiar columnas). La base de datos no se tocó.
- Detalle: [etapa2-velocidad-20261107.md](etapa2-velocidad-20261107.md).
