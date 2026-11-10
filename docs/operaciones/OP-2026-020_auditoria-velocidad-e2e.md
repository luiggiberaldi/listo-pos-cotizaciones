# OP-2026-020 — Auditoría de velocidad de punta a punta

**Fecha:** 10 de noviembre de 2026 · **Tipo:** revisión (solo lectura) · **Estado:** auditoría terminada; **no se cambió nada** en el sistema ni en la base de datos.
**Relacionados:** [plan del 2/11](plan-optimizacion-20261102.md) · [plan Supabase del 6/11](plan-optimizacion-velocidad-20261106.md) (OP-2026-010) · [etapa 2 del 7/11](etapa2-velocidad-20261107.md) (OP-2026-013).

---

## En resumen

- **Lo hecho la semana pasada funcionó.** Con las mediciones reales de producción, las operaciones más usadas tardan entre 18 % y 27 % menos que antes del 7 de noviembre.
- **La lentitud que queda no es por el peso de la app ni por internet.** Viene de tres cosas: (1) cada llamada al servidor gasta 350–400 milésimas solo en comprobar quién eres, (2) la lista de clientes se descarga unas 200 veces al día, y (3) guardar un despacho y abrir Cotizaciones hacen muchos viajes seguidos a la base de datos.
- **Hay 4 arreglos fáciles y de bajo riesgo** que se pueden hacer ya, y **4 de más impacto** que tocan el servidor o la base y deben pasar primero por el entorno de pruebas (staging).
- **Lo que no pude medir:** cuánto tarda cada pantalla en un teléfono real con sesión iniciada. No entré al sistema (requiere la clave de la empresa y un PIN). Las cifras vienen de las mediciones que el propio sistema guarda, de la base de datos y de pruebas de red desde esta computadora.

---

## 1. Cómo se midió

| Fuente | Qué dice | Periodo |
|---|---|---|
| Mediciones que guarda la app (`system_logs`, categoría RENDIMIENTO) | Cuánto tarda cada llamada al servidor, vista desde el equipo del usuario | 2 al 10 de noviembre, 4.460 llamadas, hasta 9 operadores por día |
| Estadísticas de la base de datos (`pg_stat_statements`) | Qué consultas consumen más tiempo dentro de la base | Desde el 6/11 a las 9:36 p. m. (hora de Venezuela), unos 3,7 días |
| Pruebas de red desde esta computadora | Cuánto tarda el sitio en responder y cómo entrega los archivos | Hoy |
| Compilación de análisis (copia temporal, ya borrada) | Qué hay dentro de cada archivo que descarga el navegador | Hoy |
| Lectura del código | Cómo se cargan pantallas y datos | Hoy |

"Lo normal" (p50) significa: la mitad de las veces tarda menos que eso.

## 2. Resultado de lo ya publicado (antes y después del 7/11)

| Operación | Antes | Ahora | Mejora |
|---|---|---|---|
| Descargar la lista de clientes | 1,8 s | 1,3 s | 25 % |
| Cargar la configuración | 1,2 s | 0,9 s | 26 % |
| Cambiar el estado de un despacho | 2,5 s | 2,0 s | 18 % |
| Crear un despacho | 2,1 s | 1,5 s | 27 % |

Los errores en estas rutas pasaron de 9 a 0. Aviso: los dos periodos tienen días y cargas distintas, así que es una comparación orientativa, no un experimento exacto.

## 3. Dónde se va el tiempo hoy

### 3.1 Cada llamada al servidor paga un "peaje" de identificación

De cada llamada, el servidor gasta **entre 350 y 400 milésimas** en comprobar la cuenta y el PIN antes de empezar el trabajo real. Unas **216 milésimas** de eso son una consulta al servicio de inicio de sesión de Supabase para confirmar la cuenta. El servidor recuerda la respuesta 60 segundos, pero como Cloudflare reparte las llamadas entre muchas copias del servidor, ese recuerdo sirve poco.

Ejemplo: cargar la configuración tarda 531 ms en el servidor, y 353 ms son solo la identificación.

### 3.2 La lista de clientes se descarga demasiadas veces

- **604 descargas en 3 días** (unas 200 por día) de la lista completa: 1.206 clientes, unos 275 KB cada vez, 1,3 s cada una. Es la operación que más tiempo total consume.
- Causas vistas en el código:
  1. Cada vez que alguien cambia de operador con el PIN, la app **borra todo lo que tenía en memoria** y vuelve a pedirlo.
  2. Cualquier cambio en un despacho o un pago marca la lista de clientes como "vieja" y la vuelve a descargar entera.
  3. La lista se usa en 9 pantallas (Cotizaciones, Venta rápida, Orden de compra, etc.), no solo en Clientes.
  4. Por seguridad, la lista no se guarda en el dispositivo entre una apertura y otra.

### 3.3 Abrir Cotizaciones cuesta 1 segundo solo en la base de datos

La consulta principal de la lista de cotizaciones tarda **1.044 ms de promedio** dentro de la base (215 veces en 3,7 días; la peor, 1,9 s). Después hace una segunda tanda de viajes (clientes y vendedores). La causa más probable es la regla de permisos de los renglones de cotización, que se revisa **fila por fila** para contar los artículos. Coincide con lo que el plan del 6/11 dejó pendiente como "Fase 4C". No lo comprobé hoy con una prueba directa.

### 3.4 Guardar despachos hace muchos viajes seguidos

| Operación | Tiempo en el servidor | De eso, identificación |
|---|---|---|
| Cambiar estado de un despacho | 1,6 s | 0,4 s |
| Crear despacho | 1,2 s | 0,3 s |
| Editar pago | 1,3 s | 0,2 s |

El resto son consultas a la base **una después de la otra**. El servidor corre en Estados Unidos (hoy me respondió desde Dallas) y la base está en Oregón: cada viaje entre ambos suma.

### 3.5 La lista de Despachos

- La consulta grande tarda entre 0,3 y 1,8 s según el filtro.
- Buscar por texto en notas o referencia de pago tarda 0,5 s de promedio (121 veces): la base lee todas las notas porque no tiene un índice para buscar texto.
- La consulta de pesos de despachos se hizo 969 veces.

### 3.6 Los "avisos en vivo" de respaldo son el mayor consumo de la base

El sistema tiene dos formas de avisar a los demás equipos que algo cambió: una rápida (mensaje directo entre equipos) y una de respaldo (la base revisa su propio diario de cambios). El respaldo consumió **2.449 de los 3.730 segundos** de trabajo total de la base (66 %), con 228.000 revisiones.

Hoy no hace esperar a nadie, porque la base va holgada. Pero es trabajo constante que crece con cada equipo conectado.

### 3.7 Carga inicial y cambio de pestañas

| Hallazgo | Detalle |
|---|---|
| Los archivos no se pueden guardar en el navegador | El sitio los entrega con la orden "volver a preguntar siempre" (`max-age=0`). Como sus nombres cambian en cada versión, se podrían guardar un año sin riesgo. |
| Peso al abrir | Unos 250 KB comprimidos. Es razonable; más de la mitad son las librerías base, que no se pueden quitar. |
| Primera vez que se abre cada pantalla | Se descarga su archivo (Despachos 51 KB, Inventario 46 KB, Cotizaciones 40 KB, Venta rápida 23 KB). Solo el Inicio se precarga. |
| Cada versión nueva | Cada equipo vuelve a bajar en segundo plano unos 3,7 MB. Ahí van tres logos para PDF que pesan 500 KB comprimidos. El 7/11 hubo varias publicaciones el mismo día. |
| El reloj del encabezado | Cada segundo se vuelve a dibujar todo el marco de la app (menú, encabezado, avisos), no solo el reloj. En teléfonos modestos es trabajo constante. |
| Letra del sistema | Se pide a Google en cada arranque en frío (una conexión extra). |

### 3.8 Punto ciego

La app solo mide las llamadas que pasan por el servidor propio. Las pantallas que leen **directo de la base** (inventario y las listas de cotizaciones y despachos) no quedan medidas desde el equipo del usuario. Por eso sé cuánto tardan dentro de la base, pero no cuánto espera la persona.

## 4. Lo que está bien y no hay que tocar

- **El paso por Vercel no frena.** Con la conexión ya abierta, llamar al servidor a través de Vercel o directo tarda lo mismo (150–180 ms). No vale la pena cambiarlo.
- Las listas largas ya se muestran por páginas.
- Los datos se reutilizan 5 minutos y cada pantalla se descarga solo cuando se abre.
- Los archivos viajan comprimidos.
- La base es pequeña y ya tiene los índices y las reglas de permisos rápidas del 6 y 7 de noviembre.

## 5. Recomendaciones

### A. Fáciles y de bajo riesgo (no tocan la base de datos)

| # | Qué | Qué gana el usuario | Riesgo |
|---|---|---|---|
| A1 | Permitir que el navegador guarde los archivos de la app (una regla en `vercel.json`) | Aperturas y PDF más rápidos en equipos sin la app instalada | Muy bajo |
| A2 | Sacar el reloj a una pieza propia | Menos trabajo constante en teléfonos; todo se siente más suelto | Muy bajo |
| A3 | Precargar en segundo plano Despachos, Cotizaciones, Inventario y Venta rápida al entrar | El primer cambio de pestaña después de una actualización deja de esperar | Bajo |
| A4 | Medir también las consultas directas a la base | Cierra el punto ciego: sabremos cuánto tarda de verdad cada pantalla | Muy bajo |

### B. Más impacto, pasan primero por staging

| # | Qué | Qué gana el usuario | Riesgo |
|---|---|---|---|
| B1 | Dejar de descargar la lista de clientes a cada rato: conservarla al cambiar de PIN dentro de la misma cuenta y no marcarla "vieja" por cada despacho | Cotizaciones, Venta rápida y Clientes abren sin esperar 1,3 s; unas 200 descargas menos al día | Medio-bajo: hay que cuidar que el saldo del cliente siga al día |
| B2 | Que el servidor compruebe la cuenta por sí mismo, sin consultar a Supabase en cada llamada | Hasta 200 ms menos en casi todas las llamadas | Medio: es seguridad; el control del PIN sigue igual, pero requiere pruebas completas |
| B3 | "Ubicación inteligente" del servidor (Smart Placement): que corra junto a la base | Guardar despachos más rápido, porque cada viaje a la base se acorta | Bajo: es una línea de configuración y se deshace igual. Hay que medir antes y después |
| B4 | Cotizaciones: contar los artículos sin la regla fila por fila (Fase 4C) | Abrir Cotizaciones baja de ~1 s a décimas en la base | Medio: toca permisos; mismas pruebas por rol del 7/11 |

### C. Después

| # | Qué | Nota |
|---|---|---|
| C1 | Guardar despachos en un solo paso | Lo de más impacto al guardar (2,0 s hoy), pero toca dinero e inventario. Conviene hacerlo después de B2 y B3, que ya lo bajan sin tocar esa lógica |
| C2 | Reducir los avisos en vivo de respaldo a las tablas imprescindibles | Quita el mayor consumo de la base. Hay que probar bien que los equipos sigan sincronizados |
| C3 | Índice de búsqueda de texto para notas de despacho | Búsquedas de 0,5 s a centésimas |
| C4 | Logos de PDF más livianos y letra servida desde el propio sitio | Menos datos móviles en cada actualización |

### Orden sugerido

1. A1, A2 y A4 juntos (un día, sin riesgo).
2. B1 (lista de clientes).
3. B3 con medición antes y después.
4. B2.
5. B4.
6. Volver a leer las mediciones y decidir sobre C1.

## 6. Límites de esta auditoría

- No se midió con sesión iniciada en un navegador ni en un teléfono real.
- Las pruebas de red se hicieron desde esta computadora, no desde los equipos del personal.
- La causa del segundo que tarda Cotizaciones (3.3) es la explicación más probable, no una prueba directa.
- El ahorro de B2 y B3 es una estimación; se confirma midiendo en staging.
- No se revisó la velocidad de generar PDF ni la de los reportes (ya auditados en OP-2026-006 y OP-2026-007).

## 7. Detalle técnico (para quien continúe)

- Proyecto Supabase: `oyfyuszgjwcepjpngclv`. Corte "antes/después": `ts < '2026-11-07 16:00+00'`.
- Mediciones "después" (p50 cliente / servidor / auth / cuenta, ms): `GET /api/clientes` 1335 / 839 / 375 / 216 (n=604) · `GET /api/config` 876 / 531 / 353 / 216 (n=329) · `POST /api/despachos/estado` 2014 / 1631 / 396 / 216 (n=124) · `POST /api/despachos/crear` 1509 / 1247 / 256 / 204 (n=39).
- `pg_stat_statements` (reinicio 2026-11-07 01:36 UTC, total 3.730 s): `realtime.list_changes` 228.182 llamadas, 2.449 s · lista de cotizaciones (`cotizacion_items(count)` + `notas_despacho` + `seguimiento_operativo`, filtro `vendedor_id`) 215 llamadas, media 1.044 ms · lista `notas_despacho` con `estado = ANY` 11 llamadas, media 1.768 ms · `notas ilike OR referencia_pago ilike` 121 llamadas, media 519 ms · `despacho_pesos` 969 llamadas, media 72 ms.
- Publicación `supabase_realtime`: 12 tablas; la app escucha 6 en `src/hooks/useRealtimeSync.js`.
- Identificación: `api/lib/auth.js` (`/auth/v1/user`, caché en memoria de 60 s por instancia).
- Borrado de memoria al cambiar de operador: `queryClient.clear()` en `src/store/useAuthStore.js` (3 lugares) y `src/modules/auth/LoginPage.jsx`.
- Lista de clientes: `src/hooks/useClientes.js` (clave con `perfil.id`); excluida de la persistencia en `src/utils/dashboardAccess.js` (`mayPersistQuery`).
- Cabeceras medidas en `listo-pos-cotizaciones.vercel.app`: `Cache-Control: public, max-age=0, must-revalidate` en `/`, `/assets/*.js`, `/assets/*.css`, `/sw.js` y `/logo-dark.png`; compresión `br`.
- Red (conexión reutilizada, respuesta 401 sin sesión): por Vercel 147–177 ms; Worker directo 148–176 ms. `CF-RAY` terminó en `DFW`.
- Archivo principal: 507 KB (152 KB comprimido); fuentes mayores: `react-dom`, `react-router`, `src/utils/smartSearch.js` (56 KB), `AppLayout.jsx` (54 KB), `LoginPage.jsx` (42 KB).
- Precarga del service worker: 84 archivos, 3.738 KB. `pdfLogo-*.js`, `logoListaPreciosBase64-*.js` y `logoDespachoBase64-*.js` no coinciden con los patrones excluidos en `vite.config.js` (`pdf-*.js`), así que entran en la precarga.
- Reloj: `setInterval` de 1 s en el estado de `AppLayout` (`src/components/layout/AppLayout.jsx`, línea 164).
