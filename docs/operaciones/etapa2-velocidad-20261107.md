# Etapa 2 de velocidad — lista de clientes y verificación de cada llamada

**Fecha:** 7 de noviembre de 2026 · **Estado:** puntos 1 y 2 publicados en producción; lectura de resultados programada para el martes 10/11/2026 a las 9:00 a. m.
**Planes relacionados:** [plan-optimizacion-20261102.md](plan-optimizacion-20261102.md) (etapas 0-2) · [plan-optimizacion-velocidad-20261106.md](plan-optimizacion-velocidad-20261106.md) (fases Supabase Pro).

---

## En resumen

- **Buscar clientes ya es instantáneo.** Antes, cada búsqueda en Clientes o Personal volvía a descargar los 1.206 clientes. Además, la lista ahora carga un 37 % más rápido (443 → 280 ms).
- **Cada llamada al servidor gasta una consulta menos.** La verificación de la sesión del PIN y del operador ahora se hace a la vez: en la prueba con staging bajó de 376 a 205 ms (el servidor completo, de 560 a 397 ms). No se quitó ninguna comprobación de seguridad.
- **Ahora sabemos dónde se va el tiempo.** El servidor informa en cada respuesta cuánto tardó y cuánto fue la verificación. Las mediciones también dicen qué operador las envió. El martes 10 se leen los números para decidir el siguiente paso.
- **No se tocó la base de datos.** Todo se puede deshacer con el proceso normal de publicación.

---

## 1. Punto de partida (mediciones de producción, 2-4 nov)

Rutas más usadas (tiempo en el navegador del usuario; "normal" = la mitad de las veces tarda menos que esto, p50):

| Qué hace | Llamadas | Normal (p50) | Peor caso (p95 máx.) |
|---|---|---|---|
| Abrir / buscar en la lista de clientes (`GET /api/clientes`) | 1.118 | 1,8 s | 54 s |
| Cargar la configuración (`GET /api/config`) | 524 | 1,2 s | 12,9 s |
| Cambiar estado de un despacho | 166 | 2,4 s | 7,2 s |
| Crear despacho | 44 | 2,0 s | 5,2 s |
| Mis ventas | 37 | 2,5 s | 5,0 s |

**Aclaración importante:** parecía que todas las mediciones venían de un solo usuario. No era así: todos entran con la misma cuenta de la empresa y luego cada uno pone su PIN, y las mediciones se guardaban a nombre de esa cuenta compartida. En realidad los 765 resúmenes son de todo el equipo (12 operadores activos).

## 2. Lista de clientes (PR #35)

**Qué estaba pasando**
- Las pantallas de Clientes y Personal ya filtraban la lista en el propio teléfono o computadora, pero igual le pedían al servidor la lista **completa** otra vez en cada búsqueda (300 ms después de dejar de escribir). Mientras tanto se veía el "cargando".
- Como hay más de 1.000 clientes y la base entrega máximo 1.000 por vez, el servidor pedía dos tandas **una después de la otra**.

**Qué se cambió**
| Cambio | Archivo |
|---|---|
| Clientes y Personal usan la lista ya cargada para buscar | `src/views/ClientesView.jsx`, `src/views/PersonalView.jsx` |
| El servidor pide las dos tandas a la vez; si la segunda falla, la reintenta | `api/handlers/clientes.js` |
| Orden estable entre tandas (nombre y, en empate, id) para no repetir ni perder clientes | `api/handlers/clientes.js` |
| Las mediciones y errores se guardan a nombre del operador (si su sesión venció, se envían igual) | `src/utils/errorLogger.js`, `api/handlers/logs.js` |

**Resultados**
- Descarga de la lista en producción (solo lectura, 8 repeticiones): **443 → 280 ms**, con los mismos 1.206 clientes.
- En el navegador contra staging: 3 búsquedas seguidas → **1 sola descarga**; Personal reutiliza la misma lista; consola sin errores.
- Índices de la base: ya existen los necesarios (`cuenta_id`, `vendedor_id`, `activo`); ordenar 1.206 clientes cuesta milésimas. **No hizo falta tocar la base.**

**Lo que no se cambió (a propósito)**
- Las búsquedas de clientes dentro de Despachos y Cotizaciones siguen preguntando al servidor (funcionan bien y se usan poco).
- La lista sigue trayendo las mismas columnas: quitar alguna podía romper una pantalla y la ganancia era pequeña (~270 KB).

## 3. Verificación de cada llamada (PR #36)

**Cómo se averiguó la causa (antes de tocar nada)**
1. Se pensó primero en la distancia: la base de datos está en **Oregón (us-west-2)** y los usuarios en Venezuela. Se midió que el servidor (Worker de Cloudflare) corre en Los Ángeles, cerca de la base, así que se **descartó** activar la "ubicación inteligente" (Smart Placement) por ahora.
2. Se agregó un cronómetro al servidor y se vio que **la verificación se llevaba entre el 40 % y el 60 %** del tiempo de cada llamada: buscaba la sesión del PIN y, solo cuando la tenía, buscaba al operador.
3. La configuración no tenía un problema propio: hace una sola consulta; su lentitud era esta misma verificación.

**Qué se cambió**
| Cambio | Archivo |
|---|---|
| La sesión del PIN y el operador se piden **a la vez**, usando como pista el operador que la app ya envía (`X-Operator-Id`) | `api/lib/operatorSession.js`, `api/lib/auth.js` |
| Cronómetro: cada respuesta de `/api/` trae la cabecera `Server-Timing` con `app` (servidor total), `auth` (verificación) y `cuenta` (consulta al servidor de autenticación; no aparece si estaba en caché) | `api/lib/cronometro.js`, `worker.js`, `api/lib/utils.js` |
| La app agrega ese desglose al resumen de mediciones: `srv_p50`, `auth_p50`, `cuenta_p50` por ruta | `src/utils/medirRendimiento.js`, `src/services/authFetch.js` |

**Seguridad: qué sigue igual**
- La pista del operador **no da permisos**: la sesión guardada en la base manda. Si la pista no coincide con la sesión, la llamada se rechaza (igual que antes).
- Un operador desactivado, con el rol cambiado o con el PIN cambiado queda bloqueado de inmediato.
- Si la base falla al buscar al operador, se niega el acceso.
- El desarrollador virtual nunca usa la pista.
- Cubierto por 14 pruebas automáticas nuevas, además de las 50 que ya existían para las sesiones del PIN.

**Resultados**
Comparación justa en el mismo servidor contra staging (15 llamadas de cada forma, desde Venezuela):

| | Verificación | Servidor total |
|---|---|---|
| Antes (una tras otra) | 376 ms | 560 ms |
| **Ahora (en paralelo)** | **205 ms** | **397 ms** |

En producción el ahorro por llamada será menor que en esta prueba, porque allí cada consulta a la base es más corta. El cronómetro de producción mostró que **solo confirmar la cuenta tarda ~160 ms**, más de lo estimado al principio. Por eso Smart Placement vuelve a ser una opción a evaluar con los datos del martes.

## 4. Publicación

| PR | Contenido | Publicado |
|---|---|---|
| [#35](https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/35) | Lista de clientes + mediciones por operador | 7/11/2026 (servidor y web) |
| [#36](https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/36) | Verificación en paralelo + cronómetro | 7/11/2026 (servidor y web) |

- Pruebas automáticas: **1.084 pasan**.
- Comprobado en producción: el servidor responde, rechaza credenciales falsas y el cronómetro llega a la app a través de Vercel.
- La revisión "Kilo Code Review" falla en todos los PR porque es un servicio externo sin configurar; no revisa el código y no es obligatoria.
- **Vuelta atrás:** revertir el PR correspondiente en GitHub; se vuelve a publicar solo. No hay cambios en la base de datos que deshacer.

## 5. Qué sigue

1. **Martes 10/11, 9:00 a. m.** — se ejecuta la tarea programada "Leer mediciones de rendimiento (con desglose del servidor)". Compara antes/después, separa servidor / verificación / internet por ruta y recomienda **un** siguiente paso. Solo lee; no cambia nada. (Si la app está cerrada a esa hora, corre al abrirla.)
2. Opciones que quedan, según lo que muestren los números:
   - **Guardar despachos en un solo paso** (cambiar estado ~2,4 s). Es la de más impacto, pero toca dinero e inventario: requiere staging y pruebas completas.
   - **Smart Placement** (ejecutar el servidor junto a la base de datos): es una línea de configuración y se deshace fácil. Conviene si la mayor parte del tiempo del servidor sigue siendo espera por consultas a la base.
   - **Logos de PDF más livianos**: poca ganancia.

## 6. Herramientas usadas (para repetir las mediciones)

Todas están en `tmp/` (fuera de git) y son de **solo lectura**:

| Script | Qué mide |
|---|---|
| `tmp/pt/medir_clientes_prod.mjs` / `medir_clientes_staging.mjs` | Descarga de la lista de clientes: dos tandas seguidas contra dos a la vez |
| `tmp/pt/medir_viaje_db.mjs` | Producción sin sesión: dónde corre el servidor y cuánto cuesta confirmar una credencial |
| `tmp/pt/ab_auth.mjs` | Worker local contra staging: verificación en paralelo contra secuencial |
| `tmp/pt/ver_server_timing.mjs` | Worker local contra staging: muestra la cabecera `Server-Timing` |
| `tmp/port-tools/perf_rutas.sql` | Ranking de rutas por llamadas y tiempos (tabla `system_logs`) |
| `tmp/port-tools/perf_quien.sql` | Quién envía las mediciones |
