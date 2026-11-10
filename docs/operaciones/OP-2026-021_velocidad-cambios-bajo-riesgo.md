# OP-2026-021 — Velocidad: los cinco cambios de riesgo bajo

**Fecha:** 10 de noviembre de 2026 · **Origen:** auditoría [OP-2026-020](OP-2026-020_auditoria-velocidad-e2e.md) · **Estado:** ver la sección "Publicación" al final.

---

## En resumen

- Se aplicaron los **cinco cambios de riesgo bajo** que recomendó la auditoría: A1, A2, A3, A4 y B3.
- **No se tocó la base de datos**, ni dinero, ni inventario, ni permisos. Todo se deshace revirtiendo la solicitud de cambio.
- Se probó con las 1.095 pruebas automáticas y en un navegador real contra el entorno de pruebas (staging).
- **Quedan pendientes** los tres cambios de riesgo medio o alto (B1, B2 y B4) y los de la lista "para después". Necesitan pruebas completas en staging y, en un caso, una decisión del dueño.

## Qué se cambió

| # | Cambio | Qué nota el usuario | Archivo |
|---|---|---|---|
| A1 | El navegador ya puede guardar los archivos de la app durante un año. Sus nombres cambian en cada versión, así que nunca queda uno viejo | Aperturas más rápidas en equipos sin la app instalada y al generar PDF | `vercel.json` |
| A2 | El reloj del encabezado es ahora una pieza aparte | Antes, cada segundo se redibujaba todo el marco (menú, encabezado, avisos). Ahora solo el reloj. Menos trabajo constante en teléfonos | `src/components/layout/AppLayout.jsx` |
| A3 | Al entrar con el PIN se descargan en segundo plano las pantallas más usadas | El primer cambio a Despachos, Inventario, Cotizaciones o Venta rápida ya no espera la descarga | `src/App.jsx` |
| A4 | La app ahora mide también las consultas que van directo a la base de datos | Nada visible. Sirve para saber cuánto tarda de verdad cada pantalla | `src/services/supabase/client.js`, `src/utils/medirRendimiento.js` |
| B3 | "Ubicación inteligente": Cloudflare ejecuta el servidor cerca de la base de datos | Guardar y cargar deberían tardar menos, porque cada consulta a la base hace un viaje más corto | `wrangler.toml` |

### Detalles que conviene saber

- **A1:** además, si el navegador pide un archivo de una versión vieja que ya no existe, el sitio ahora responde "no existe" en vez de entregar la página de inicio. La app ya sabía manejar ese caso: muestra "Nueva versión disponible" o se recarga sola. El servidor de Cloudflare ya trabajaba así; solo faltaba Vercel.
- **A3:** logística precarga Despachos e Inventario; los demás roles, también Cotizaciones y Venta rápida. Si el teléfono tiene activado el "ahorro de datos", no se precarga nada. Se hace una sola vez por apertura de la app.
- **A4:** solo se guarda el nombre de la tabla o función, el tiempo y si respondió bien (por ejemplo `db:clientes`). **Nunca** filtros, identificadores ni datos de clientes. Si la medición fallara, la consulta sigue igual. El resumen admite ahora 50 rutas en vez de 30.
- **B3:** Cloudflare tarda unos 15 minutos en analizar el tráfico antes de mover el servidor, y puede decidir no moverlo si no ve ventaja. Deja siempre 1 % de las llamadas sin mover para comparar. No afecta la tarea automática de las noches ni el aviso de cobranza de las 8:00 a. m.

## Cómo se probó

| Prueba | Resultado |
|---|---|
| Pruebas automáticas (`npm test`) | 1.095 pasan (una nueva para A4) |
| Compilación | Correcta; el peso inicial no cambió (152 KB comprimido) |
| Configuración del servidor (`wrangler deploy --dry-run`) | Válida |
| Navegador real, esta rama contra staging (`tmp/op021-ui.mjs`) | Entra con el operador de pruebas · el reloj avanza · las cuatro pantallas se precargan solas · abren Despachos, Cotizaciones, Inventario, Clientes e Inicio · llegan las mediciones nuevas (`db:productos`, `db:cotizaciones`, `db:notas_despacho`…) sin filtros ni identificadores · las mediciones del servidor siguen llegando · 0 errores de página |

Para esa prueba se renovó la clave de la cuenta de pruebas de staging con el preparador del proyecto (`npm run provision:e2e:staging`). Solo afecta esa cuenta; la prueba nocturna la renueva sola cada noche.

**No se pudo probar antes de publicar:**
- A1: las cabeceras de Vercel solo existen una vez publicado.
- B3: la ubicación inteligente solo existe en Cloudflare, y su efecto se ve en las mediciones de los días siguientes.
- A2: se comprobó que el reloj funciona, no se midió cuánto trabajo ahorra en un teléfono.

## Cómo deshacer

- **Todo:** revertir la solicitud de cambio en GitHub; se vuelve a publicar solo.
- **Solo B3:** borrar el bloque `[placement]` de `wrangler.toml` y publicar.
- No hay nada que deshacer en la base de datos.

## Qué falta (no se aplicó)

| # | Qué | Por qué no se aplicó hoy |
|---|---|---|
| B1 | Dejar de descargar la lista de clientes unas 200 veces al día | Riesgo medio-bajo. Requiere una decisión: cuánto retraso se acepta en el saldo del cliente que ve el vendedor. Y probar el cambio de PIN en equipos compartidos |
| B2 | Que el servidor compruebe la cuenta sin consultar a Supabase en cada llamada | Es la puerta de entrada al sistema. Requiere pruebas completas de seguridad en staging |
| B4 | Regla de permisos que hace lenta la lista de Cotizaciones | Toca quién ve qué. Requiere la comparación por rol, antes y después, como la del 7/11 |
| C1 | Guardar despachos en un solo paso | Toca dinero e inventario. Se decide después de ver el efecto de B3 |
| C2 | Reducir los avisos en vivo de respaldo | Hay que probar que los equipos sigan sincronizados |
| C3 | Índice de búsqueda de texto en notas de despacho | Cambio en la base de datos |
| C4 | Logos de PDF más livianos y letra servida desde el propio sitio | Poca ganancia; cambia cómo salen los PDF |

**Siguiente lectura de mediciones:** en dos o tres días de uso normal, comparar el tiempo del servidor antes y después de B3 y leer por primera vez las mediciones de la base (A4).

**Copia de staging:** la carpeta `construacero-staging/` no recibió estos cambios; sus archivos ya eran distintos a los de producción.

## Publicación

*(Se completa al publicar.)*
