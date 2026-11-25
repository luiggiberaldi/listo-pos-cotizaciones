# OP-2026-025 — Búsquedas de despachos y cotizaciones sin recortes

**Fecha inicial:** 2026-11-10 · **Retomado y preparado para producción:** 2026-11-25 · **Rama:** `feat/op-025-busqueda-sin-limites` (desde `main` `fa13d0c2`, en la carpeta aparte `construacero-op025`) · **Estado:** 🧪 Solicitud de cambio **#79** abierta (commit `8a7111a9`); pendiente de tu visto bueno final para publicar.

## En resumen

- Al buscar en **Despachos** y **Cotizaciones**, el sistema **recortaba resultados sin avisar**: 200 en despachos y 60 por cliente en cotizaciones. Ahora **las búsquedas traen todo**.
- Al retomarlo aparecieron **dos fallas más**, que también quedan arregladas:
  1. **La búsqueda de cotizaciones antiguas por nombre de cliente no traía nada en producción.** El pedido salía sin la "identificación del operador" y el servidor lo rechazaba ("No hay una sesión de operador activa"). Con el arreglo, en la prueba se pasó de **0** a **11** cotizaciones encontradas para un mismo cliente.
  2. **Con búsquedas grandes, los clientes habrían salido como "—".** El servidor solo acepta 200 clientes por consulta; ahora se piden en tandas de 200.
- La **lista normal** (sin escribir nada) sigue mostrando los 200 más recientes, para que abra rápido. **Clientes** ya mostraba todo y no se tocó.
- Solo cambia la pantalla: no toca base de datos, dinero ni inventario.

## Qué cambió (en palabras simples)

| Dónde | Antes | Ahora |
|---|---|---|
| Despachos → buscar | Máximo 200 resultados | Todos los resultados |
| Despachos → buscar 1 sola letra (p. ej. "a") | Buscaba en el servidor (máx. 200) | Filtra solo los despachos ya cargados en pantalla; el servidor se consulta desde **2 letras** (o desde 1 si es un número), igual que en Cotizaciones. Evita que una letra suelta traiga miles de despachos. |
| Cotizaciones → buscar en el histórico por cliente | No funcionaba (servidor respondía 403) y, si hubiera funcionado, máximo 60 | Funciona y trae todas |
| Cotizaciones → buscar por número | Máximo 20 | Máximo 200 (versiones de un mismo número) |
| Nombres de clientes en resultados grandes | Una sola consulta (el servidor rechaza más de 200) | Tandas de 200 |
| Carga del servidor | Sin control | Máximo **4 consultas a la vez** en las búsquedas grandes |

## Detalle técnico

- `src/services/apiBase.js`: nuevas funciones `traerTodo` (pide de 1000 en 1000 hasta el final, con orden estable), `mapConLimite` (máximo N consultas simultáneas) y `lookupClientesPorIds` (busca clientes en tandas de 200; si una tanda falla, el resto se muestra).
- `src/hooks/useDespachos.js`: búsqueda sin tope, texto desde 2 caracteres, lotes de 50 ids con máximo 4 consultas a la vez, pesos en tandas limitadas y clientes en tandas de 200.
- `src/hooks/useCotizaciones.js` (`useBuscarCotizaciones`): sesión de operador en `/api/clientes?busqueda=`, sin tope de 60, lotes con límite, resultados ordenados por fecha de actualización y clientes en tandas de 200.
- Prueba nueva: `src/utils/__tests__/busquedaSinLimites025.test.js` (10 pruebas).
- La versión de este arreglo que estaba sin guardar en la carpeta principal mezclaba cambios de otros casos (OP-042, 052, 053, 054) que ya están en producción; solo se portó lo de OP-025.

## Verificación (2026-11-25)

- **Pruebas nuevas:** 10/10. **Batería completa:** 1264 aprobadas; 1 archivo (`medirRendimientoServerTiming.test.js`) no arranca porque pide credenciales de base de datos que la carpeta aparte no tiene a propósito (igual que antes, ajeno a este cambio).
- **Lint:** 0 errores en los archivos tocados (igual que antes del cambio). **Compilación:** correcta.
- **Navegador (pantalla de la rama conectada a staging, datos de prueba):**
  - Despachos (39 en staging): "prueba" → 23, "a" → 34 (filtro local), "4907" → 1, "luna" → 5, texto inexistente → 0, vacío → 39; ningún cliente como "—".
  - Cotizaciones, histórico por cliente: "OP032" → 5, "Fixture" → 11, "Cliente propio" → 1 (antes del arreglo de la sesión: 0 en los tres); consultas al servidor 200 OK.
  - Errores ajenos al cambio en la prueba local: `/api/rates` (tasas; montaje local) y `/rest/v1/productos` 400 (staging ya no tiene la columna de stock comprometido que pide producción).
- **Sin verificar:** staging tiene pocos datos, así que no se pudo ver en pantalla una búsqueda de más de 200 resultados; ese caso lo cubren las pruebas automáticas (`traerTodo` con 2350 filas y `lookupClientesPorIds` con 450 clientes).

## Pendiente

1. ~~Tu visto bueno a la prueba en el navegador~~ (dado el 2026-11-25).
2. ~~Guardar, subir y abrir la solicitud~~: hecho, solicitud #79 (https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/79). Falta mirar la vista previa (datos reales: solo mirar) y tu aprobación final para unir a `main`.
3. Después de publicar: buscar un cliente con muchas cotizaciones/despachos y comprobar que aparecen los antiguos.
