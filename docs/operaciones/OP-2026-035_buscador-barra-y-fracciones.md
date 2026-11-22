# OP-2026-035 — Revisión y corrección del buscador con barra `/` y medidas en fracciones (ej. "cabillas de 1/2")

**Fecha:** 21 de noviembre de 2026 · **Tipo:** diagnóstico + corrección · **Estado:** **PUBLICADO en producción el 21-nov-2026** — solicitud **#62**, commits `538feb42` (código) y `be998129` (pruebas), unión en `main` `966b26a4`. Probado antes en staging (344/344 pruebas + 23/23 en navegador real contra 445 productos activos) y en la rama principal (1.068/1.068 pruebas + build de producción OK).

---

## Actualización 21-nov-2026 — Corrección aplicada y verificada en staging

### Qué se corrigió (en `construacero-staging/`)
- **`construacero-staging/src/utils/smartSearch.js`**:
  1. **Equivalencias comerciales pulgadas ↔ milímetros** (`1/4"` ↔ `6 mm`, `3/8"` ↔ `10 mm`/`9,5 mm`, `1/2"` y `media` ↔ `12 mm`/`12,7 mm`, `5/8"` ↔ `16 mm`, `3/4"` ↔ `20 mm`/`19 mm`, `7/8"` ↔ `22 mm`, `1"` ↔ `25 mm`), con verificación estricta de límites numéricos para no confundir `12 mm` con `12 metros` ni `6 mm` con `16 mm`.
  2. **Normalización de la barra `/` y fracciones:** une espacios alrededor de `/` (`1 / 2` → `1/2`), normaliza guiones antes de fracciones (`1-1/2` → `1 1/2`, `4-1/2` → `4 1/2`), separa largos en metros acoplados con `x` (`1/2 x 12 mts`) y conserva abreviaciones válidas con barra (`a/n`, `c/rosc`, `c/flanche`) sin destruir sus sinónimos.
  3. **Extracción y comparación de medidas con `x` y fracciones (`extractInchSizes` / `sizesConflict`):** ya no pega códigos de 3-4 dígitos (ej. electrodos `6013`, `7018`, `6010`) con la fracción siguiente (`3/32`, `1/8`); reconoce dimensiones completas con fracciones (`1 x 1/8`, `1 1/2 x 1 1/2`, `7" x 1/16`, `5/8 x 2 1/2`); evita división por cero en cables `2/0` y `1/0`; exige límites exactos para fracciones simples (para que `tubo 1/2` no traiga tubos `3 x 1 1/2`) y para sinónimos de 1-2 letras (para que `a/n` no coincida dentro de "rectangular").
  4. **Búsqueda por código (`matchByCode`):** cuando la búsqueda tiene `/`, ya no borra la barra para buscar dígitos dentro de códigos SKU (se eliminaron los falsos positivos al buscar `1/4`, `1/2`, `3/8`, `2/0`).
- **Pruebas nuevas creadas:**
  - `construacero-staging/src/utils/__tests__/smartSearchSlash.test.js` (8 bloques de pruebas cubriendo todos los casos anteriores).
  - `construacero-staging/scripts/verify-op035-buscador-staging.mjs` (guion de verificación real en navegador contra staging, solo lectura).

### Resultado de las pruebas en staging
- **Pruebas automáticas (`npm --prefix construacero-staging test`):** **40/40 archivos, 344/344 pruebas en verde**.
- **Construcción (`npm --prefix construacero-staging run build`):** **OK** (sin errores).
- **Prueba real en navegador contra staging (`http://localhost:5174`, 445 productos activos reales de la cuenta `supervisor@listo.sys`):** **23/23 en verde, 0 errores en consola**:
  - **Inventario (18/18):** `cabillas de 1/2`, `cabilla 3/8`, `cabilla 5/8`, `cabilla 3/4`, `cabilla media`, `cabilla 1/2 x 12 mts`, `electrodo 1/8`, `electrodo 3/32`, `pletina 1 x 1/8`, `pletina 1 1/2 x 1/8`, `tubo 1 1/2 x 1 1/2`, `codo a/n 4`, `tubo 1-1/2`, `codo 1 / 2`, `disco 7"`, `tornillo 5/8 x 2 1/2`, `2/0` y `1/4` (sin falsos positivos de cabillas ni láminas).
  - **Venta Rápida (4/4):** `cabillas de 1/2`, `electrodo 1/8`, `pletina 1 x 1/8` y `codo 1 / 2`.
  - **Navegador (1/1):** 0 errores de JavaScript.
- **No verificado todavía:** la pantalla de **Cotizaciones → Nueva cotización** en vivo (requiere elegir cliente primero en el flujo; usa el mismo `useProductSearch` → `smartSearchProductos` ya verificado en Venta Rápida e Inventario) y el paso al árbol principal / publicación en producción.

---

## En resumen

- **El problema tiene dos causas distintas**, y ambas afectan a casi todos los buscadores de productos del sistema (Inventario, Venta Rápida, Cotizaciones, Editar ítems de despacho, Devolución parcial, Búsqueda de lista, Movimientos e Ingreso en lote), porque todos comparten el mismo motor de búsqueda (`src/utils/smartSearch.js`).
- **Causa 1 — Por qué `"cabillas de 1/2"` dice que no existe:** en el catálogo real, las **15 cabillas** (y las **6 barras lisas**) están guardadas en **milímetros** (`10 mm`, `12 mm`, `16 mm`, `20 mm`, `22 mm`, `25 mm`), no en pulgadas (`3/8`, `1/2`, `5/8`, `3/4`, `7/8`, `1"`). El buscador busca literalmente `"1/2"` en el nombre y, al no encontrarlo, responde "Sin resultados" (aunque sí existen 4 cabillas de `12 mm`, que son las de `1/2"`).
- **Causa 2 — Sí hay fallos reales al reconocer la barra `/`**, incluso en productos que **sí llevan `/` en su nombre**:
  1. **Electrodos (`electrodo 1/8`, `electrodo 3/32`):** devuelven **0 resultados** (todos los 7 electrodos desaparecen).
  2. **Medidas combinadas con `x` y `/` (`pletina 1 x 1/8`, `pletina 1 1/2 x 1/8`, `tubo 1 1/2 x 1 1/2`, `tornillo 5/8 x 2 1/2`, `tornillo 5/8 x 3`):** devuelven **0 resultados** o productos equivocados (láminas de techo en vez de pletinas).
  3. **Abreviaciones con `/` (`codo a/n 4`, `tubo a/n`):** el buscador **borra la barra `/`** cuando no está entre dos números y rompe sus propios sinónimos (`a/n`, `c/rosc`).
  4. **Espacios o guiones alrededor de la fracción (`codo 1 / 2`, `tubo 1-1/2`, `disco 4-1/2`):** devuelven **0 resultados** o pierden el producto correcto.
  5. **Buscar solo una fracción (`1/2`, `1/4`, `3/8`, `1/8`, `2/0`):** el buscador por código borra la barra `/` y convierte `1/4` en `14` o `1/2` en `12`, poniendo decenas de productos falsos arriba del todo (por ejemplo, buscar `1/4` trae todas las cabillas porque su código empieza por `CAB0114`).
- **Alcance verificado:** se revisó todo el código de búsqueda (pantallas, servidor y base de datos) y se ejecutaron pruebas reales contra los **465 productos activos** del respaldo de producción del 18 de octubre de 2026 (`construacero-backups/2026-10-18/datos.sql`). No se consultó la base en vivo porque la herramienta de base de datos no tenía sesión activa; si después del 18-oct se crearon productos nuevos con otro formato de nombre, conviene verificarlos al probar el arreglo.

---

## 1. Dónde ocurre el problema

Todos los buscadores de productos de la aplicación pasan por el mismo cerebro: `src/utils/smartSearch.js` (`smartSearchProductos`). Una analogía: es como si todas las cajas y mostradores de la tienda usaran el mismo recepcionista para buscar mercancía en la lista; si ese recepcionista lee mal la barra `/`, falla en todas las pantallas a la vez:

- Inventario (`src/views/InventarioView.jsx`)
- Venta Rápida (`src/views/VentaRapidaView.jsx`)
- Cotizaciones: buscador principal, cotización rápida y escaneo de listas (`CotizacionBuscador.jsx`, `CotizacionRapida.jsx`, `ScanMaterialListModal.jsx`, `ProductoAutocomplete.jsx`)
- Despachos: editar ítems y devoluciones parciales (`EditarItemsDespachoModal.jsx`, `DevolucionParcialModal.jsx`)
- Herramientas de inventario: búsqueda de lista, movimientos en lote e ingreso en lote (`BusquedaListaModal.jsx`, `MovimientoLoteModal.jsx`, `IngresoLoteHubModal.jsx`)

*(Nota aparte: el modal de cambio masivo de precios `ModalBatchPrice.jsx` usa una búsqueda básica de texto literal, sin `smartSearch.js`, así que tampoco entiende sinónimos ni equivalencias.)*

---

## 2. Hallazgo principal: por qué `"cabillas de 1/2"` dice que no existe

En el catálogo real, **ninguna cabilla ni barra lisa tiene `/` en el nombre**. Todas están escritas en milímetros:

| Medida comercial en pulgadas | Cómo está guardada en el inventario | Productos activos en respaldo (18-oct) |
|---|---|---|
| `3/8"` | `10 mm` | 3 cabillas (`CABILLA ESTRIADA 10 mm...`) + 1 barra lisa (`10mm`) |
| `1/2"` | `12 mm` | 4 cabillas (`CABILLA ESTRIADA 12 mm...` SIDETUR y SIDOR) + 2 barras lisas (`12mm`) |
| `5/8"` | `16 mm` | 2 cabillas (`CABILLA ESTRIADA 16 mm...`) + 1 barra lisa (`16 mm`) |
| `3/4"` | `20 mm` | 4 cabillas (`CABILLA ESTRIADA 20 mm...` SIDETUR y SIDOR) + 1 barra lisa (`20 mm`) |
| `7/8"` | `22 mm` | 1 cabilla (`CABILLA ESTRIADA 22 mm...`) |
| `1"` | `25 mm` | 1 cabilla (`CABILLA ESTRIADA 25 mm...`) + 1 barra lisa (`25 mm`) |

**Qué pasa hoy cuando alguien busca `"cabillas de 1/2"` (o `"cabilla media"`):**
1. El buscador quita la palabra `"de"` y queda buscando dos cosas obligatorias: `"cabilla"` **Y** `"1/2"`.
2. Encuentra `"cabilla"`, pero no existe `"1/2"` dentro de `"CABILLA ESTRIADA 12 mm X 12,00 mts SIDETUR"`.
3. Como exige que coincidan todas las palabras (`requiredCoverage = 1` en `src/utils/smartSearch.js:1198`), descarta todas las cabillas y muestra **"Sin resultados"**.
4. Si hoy el vendedor escribe `"cabilla 12"` o `"cabilla 12mm"`, sí aparecen las 4 cabillas de 1/2".

---

## 3. Los 6 fallos reales del buscador al procesar la barra `/`

Además del caso de cabillas en milímetros, el catálogo tiene **111 productos activos que SÍ llevan `/` en su nombre** (tubos, conexiones, pletinas, electrodos, tornillos, discos, cables). Al probarlos contra el buscador actual, aparecen **6 errores concretos**:

### 3.1 Electrodos con fracción (`1/8`, `3/32`): 0 resultados
- **Qué pasa:** buscar `electrodo 1/8` o `electrodo 3/32` devuelve **0 resultados**, aunque existen 7 electrodos en inventario (`ELECTRODO 6013 3/32 HOFFMAN`, `ELECTRODO 7018 1/8 GRICON`, `ELECTRODO 6010 1/8 ROSSMAN`, etc.).
- **Por qué:** el lector de medidas (`extractInchSizes` en `src/utils/smartSearch.js:976`) pega el número del modelo con la fracción siguiente y cree que el producto mide **"6013 3/32 pulgadas"** (más de 6.000 pulgadas) en lugar de modelo `6013` y grosor `3/32"`. Al compararlo con `3/32`, dice que la medida no coincide y descarta el producto.

### 3.2 Medidas con `x` junto a una fracción (`1 x 1/8`, `1 1/2 x 1/8`, `1 1/2 x 1 1/2`, `5/8 x 2 1/2`): 0 resultados o productos falsos
- **Qué pasa:**
  - `pletina 1 x 1/8` y `pletina 1 x 1/4` **no traen las pletinas** (que existen: `PLETINA 1 X 1/8 X 6,00 mts`, `PLETINA 1 X 1/4 X 6,00 mts`) y en su lugar muestran **2 láminas arquitectónicas de techo**.
  - `pletina 1 1/2 x 1/8`, `pletina 1 1/2 x 3/16`, `tubo 1 1/2 x 1 1/2`, `tornillo 5/8 x 2 1/2`, `tornillo 5/8 x 3`, `tornillo 1/2 x 2 1/2` y `tornillo 1 x 3 1/2` devuelven **0 resultados** aunque todos existen en inventario.
  - Incluso `disco 7"` devuelve **0 resultados** (a pesar de que existen `DISCO DE CORTE 7" X 1/16` y `DISCO DE ESMERILAR 7" X 1/16`).
- **Por qué:** la regla que extrae medidas con `x` (`src/utils/smartSearch.js:976`) solo entiende números enteros o decimales, no fracciones con `/`. Al leer `1x1/8`, lo corta mal como **`1x1`** y un **`8`** suelto; al leer `7"x1/16`, lo corta como **`7x1`**. Y cuando la consulta lleva `x` con fracción (`1 1/2x1/8`), `sizesConflict` (`src/utils/smartSearch.js:1010`) la marca en conflicto con las piezas sueltas del producto (`1 1/2` y `1/8`) y lo descarta.

### 3.3 Abreviaciones con `/` (`A/N`, `C/ROSC.`): el buscador borra la `/` y daña sus propios sinónimos
- **Qué pasa:**
  - Buscar `codo a/n 4` devuelve **0 resultados**, aunque existen 3 codos de aguas negras de 4" (`CODO A.N 4" X 90 TUBRICA`, etc.).
  - Buscar `tubo a/n` devuelve **80 tubos cualquiera** en vez de los 16 tubos de aguas negras.
- **Por qué:** en `preprocessQuery` (`src/utils/smartSearch.js:779`), una regla reemplaza por un espacio **cualquier `/` que no tenga dígitos a ambos lados**. Eso convierte `a/n` en dos letras sueltas (`"a"` y `"n"`), y `c/rosc` en `"c"` y `"rosc"`. Por eso los sinónimos ya programados para `'a/n'` y `'c/rosc'` (`src/utils/smartSearch.js:108,119`) nunca llegan a ejecutarse.

### 3.4 Espacios o guiones al escribir la fracción (`1 / 2`, `1-1/2`, `4-1/2`)
- **Qué pasa:**
  - Si el usuario escribe con espacios alrededor de la barra (muy común en celular: `codo 1 / 2` o `tubo 1 / 2`), la misma regla de la línea 779 borra la `/` y parte el número en `"1"` y `"2"`. Resultado: `codo 1 / 2` da **0 resultados** y `tubo 1 / 2` pierde los 17 tubos de 1/2".
  - Si escribe con guion (`tubo 1-1/2`, `disco 4-1/2`), da **0 resultados** porque el catálogo usa espacio (`1 1/2`, `4 1/2`) y el motor no normaliza el guion antes de la fracción.

### 3.5 Buscar solo una fracción (`1/2`, `1/4`, `3/8`, `1/8`, `2/0`) trae decenas de falsos positivos arriba
- **Qué pasa:** el buscador de códigos (`matchByCode`, `src/utils/smartSearch.js:1221`) borra todo lo que no sea letra o número, incluyendo la `/`.
  - `"1/2"` se vuelve `"12"` → mete **19 productos falsos** cuyo código contiene `12` (ej. `TUB0202012`) en primer lugar con puntaje máximo.
  - `"1/4"` se vuelve `"14"` → mete **61 productos falsos** (¡todas las cabillas `CAB0114...` y los zunchos `ZUN014...`!) por encima de los productos de 1/4".
  - `"3/8"` se vuelve `"38"` → mete **10 productos falsos** (las mallas `MAL0138...`).
  - `"2/0"` se vuelve `"20"` → mete **99 productos falsos** encima de `ARVIDAL 2/0`.

### 3.6 Búsqueda en el servidor (actualmente de respaldo)
- La función de base de datos `buscar_productos_hibrido` (`supabase/migrations/277_tenant_obligatorio_rpcs_productos.sql:78`) usa búsqueda de texto de PostgreSQL (`plainto_tsquery('spanish', ...)`) que también parte `1/2` en `"1"` y `"2"`. Hoy no afecta a las pantallas normales porque todas cargan el catálogo y filtran con `smartSearch.js`, pero conviene tenerlo presente si alguna pantalla vuelve a usar búsqueda en el servidor.

---

## 4. Resumen de pruebas reales (respaldo 18-oct-2026)

| Qué escribe el usuario | Qué responde hoy | Qué debería encontrar (en inventario real) | Causa |
|---|---|---|---|
| `cabillas de 1/2` | 0 resultados | 4 cabillas `12 mm` (SIDETUR y SIDOR) | Equivalencia pulgada ↔ mm inexistente |
| `cabilla 3/8` | 0 resultados | 3 cabillas `10 mm` | Equivalencia pulgada ↔ mm inexistente |
| `cabilla 5/8` | 0 resultados | 2 cabillas `16 mm` | Equivalencia pulgada ↔ mm inexistente |
| `cabilla 3/4` | 0 resultados | 4 cabillas `20 mm` | Equivalencia pulgada ↔ mm inexistente |
| `barra 1/2` | 0 resultados | 2 barras lisas `12mm` | Equivalencia pulgada ↔ mm inexistente |
| `electrodo 1/8` | 0 resultados | 5 electrodos de `1/8` | Modelo + fracción pegados (`7018 1/8`) |
| `electrodo 3/32` | 0 resultados | 2 electrodos de `3/32` | Modelo + fracción pegados (`6013 3/32`) |
| `pletina 1 x 1/8` | 2 láminas de techo | `PLETINA 1 X 1/8 X 6,00 mts` | Regex de `x` corta `1x1/8` en `1x1` |
| `pletina 1 1/2 x 1/8` | 0 resultados | `PLETINA 1 1/2 X 1/8 X 6,00 mts` | Conflicto `x` con fracciones |
| `tubo 1 1/2 x 1 1/2` | 0 resultados | 3 tubos pulidos cuad. `1 1/2 X 1 1/2` | Conflicto `x` con fracciones |
| `tornillo 5/8 x 2 1/2` | 0 resultados | `TOR A325 ... 5/8 X 2 1/2` | Conflicto `x` con fracciones |
| `disco 7"` | 0 resultados | 2 discos `7" X 1/16` | Regex de `x` corta `7"x1/16` en `7x1` |
| `codo a/n 4` | 0 resultados | 3 codos `A.N 4"` | Limpieza de `/` rompe `a/n` |
| `tubo 1-1/2` | 0 resultados | 22 tubos `1 1/2` | Guion antes de fracción no normalizado |
| `codo 1 / 2` | 0 resultados | 4 codos `1/2` | Espacios alrededor de `/` borran la barra |
| `1/4` (solo) | 63 (61 falsos arriba) | 6 productos de `1/4` | `matchByCode` borra `/` → busca `14` en códigos |

---

## 5. Propuesta de corrección (pendiente de aprobación)

Todo se puede corregir en un solo lugar principal (`src/utils/smartSearch.js`) más sus pruebas automáticas, sin tocar los nombres existentes en la base de datos:

1. **Equivalencias pulgadas ↔ milímetros (para medidas estándar en ferretería venezolana):**
   - Cuando se busque `1/2` (o `media`), `3/8`, `5/8`, `3/4`, `7/8`, `1/4`, `1"`, permitir que coincida con su medida comercial en mm (`12mm`, `10mm`, `16mm`, `20mm`/`19mm`, `22mm`, `6mm`, `25mm`) — cuidando que **solo** matchee la medida en mm exacta (con `mm` o en productos métricos como cabillas/barras/alambrones) para no mezclar tubos de 12 metros con 12 mm.
2. **Normalizar espacios y guiones en fracciones antes de limpiar barras:**
   - `1 / 2` → `1/2`; `1-1/2` → `1 1/2`.
   - Proteger abreviaciones conocidas con barra (`a/n`, `c/rosc`, `c/flanche`, `c/18`) para que no se destruyan al limpiar barras sueltas.
3. **Corregir la extracción de medidas (`extractInchSizes`) y comparación (`sizesConflict`):**
   - No pegar números de modelo de 3 o más dígitos (`6013`, `7018`, `6010`, `532`) con la fracción siguiente (`1/8`, `3/32`).
   - Soportar fracciones dentro de dimensiones con `x` (`1 x 1/8`, `1 1/2 x 1 1/2`, `7" x 1/16`, `5/8 x 2 1/2`) sin partirlas por la mitad.
4. **Corregir `matchByCode`:**
   - Si lo que escribió el usuario es una fracción con `/` (como `1/2`, `1/4`, `3/8`, `2/0`), **no** buscarlo quitándole la barra dentro de los códigos SKU.
5. **Batería de pruebas automáticas** cubriendo los 16 casos de la tabla anterior para garantizar que no vuelva a romperse.

## 6. Publicación en producción (21-nov-2026)

- **Solicitud de cambio:** PR **#62** (`fix/op-035-buscador-barra-fracciones` → `main`).
- **Commits:** `538feb42` (`src/utils/smartSearch.js`), `be998129` (`src/utils/__tests__/smartSearchSlash.test.js`), unión en `main` `966b26a4`.
- **Pruebas en `main` antes de publicar:** **107/107 archivos, 1.068/1.068 pruebas automáticas en verde**; build de producción (`vite build` + Service Worker PWA) **OK**.
- **Verificación posterior al despliegue en producción:**
  - GitHub Actions (`Deploy Worker a Cloudflare`, ejecución `44983062394`): **en verde** (48 s).
  - Vercel (`https://listo-pos-cotizaciones.vercel.app`): **HTTP 200** y confirmado que el archivo publicado en vivo (`assets/index-B_4pikAR.js`) ya incluye el arreglo de OP-2026-035.
  - Worker (`/api/ping` → **200 ok**; `/api/clientes` sin sesión → **401 No autenticado**).
- **Pendiente de verificación humana:** probar en producción (recargando si aparece el aviso "Hay una versión nueva") buscando `"cabillas de 1/2"` y `"electrodo 1/8"` desde un teléfono o PC real.
