# OP-2026-023 — Auditoría de errores y fallos de punta a punta

**Fecha:** 10 de noviembre de 2026 · **Tipo:** revisión (solo lectura) · **Estado:** auditoría terminada; **no se cambió nada** en el sistema ni en la base de datos.

---

## En resumen

- **El dinero está bien.** Los saldos de los 1.206 clientes coinciden exactamente con su historial de movimientos, y no hay despachos con número repetido ni comisiones duplicadas.
- **Hay tres problemas serios que nadie estaba viendo:**
  1. El **vigilante nocturno de saldos está caído desde el 11 de septiembre** (64 noches fallando) y no avisa a nadie.
  2. Los **avisos al teléfono (push) no funcionan**: al servidor de producción le faltan las llaves de envío.
  3. Hay **una función de la base de datos que permite agregar deuda a cualquier cliente sin comprobar quién la llama**, abierta incluso sin iniciar sesión.
- Hay además **cinco asuntos medianos** (uno de código, uno de pruebas y tres de datos por limpiar o confirmar) y varios menores.
- **Lo que no cubrí:** no leí las 35.000 líneas una por una. Me guié por lo que registra el propio sistema, por la base de datos y por las zonas de dinero e inventario. No ejecuté nada que escriba datos.

---

## 1. Cómo se revisó

| Fuente | Qué se miró |
|---|---|
| Registro de errores del sistema (`system_logs`) | Últimos 14 días y el histórico |
| Vigilantes automáticos de GitHub | Historial de las últimas 65 a 77 ejecuciones de cada uno |
| Base de datos de producción (solo lectura) | Saldos, comisiones, inventario, despachos, permisos de funciones |
| Diagnóstico de seguridad de Supabase | Todas sus alertas |
| Código | Servidor (despachos, cobros, comisiones), búsquedas, llaves que usa el servidor |
| Revisión automática de código (ESLint) y pruebas | 1.095 pruebas pasan |

## 2. Problemas serios

### 2.1 El vigilante de saldos lleva dos meses caído

**Qué es:** una revisión automática que cada noche compara el saldo de cada cliente con su historial de cargos y abonos, y revisa las comisiones. Es la alarma que avisaría si un saldo se descuadra.

**Qué pasa:** falla en el primer paso con "llave de acceso inválida". La llave con la que entra a Supabase venció o fue revocada. La última vez que funcionó fue el **11 de septiembre de 2026**; desde entonces, 64 fallos seguidos. Tampoco tiene configurado a dónde enviar la alerta, así que nadie se enteró.

**Qué hice:** corrí a mano la misma revisión contra producción. Resultado en la sección 4.

**Arreglo:** crear una llave nueva en Supabase y guardarla en GitHub (secreto `MAIN_SUPABASE_ACCESS_TOKEN`). Lo tiene que hacer el dueño de la cuenta; son unos 5 minutos. Conviene configurar también el aviso (`MAIN_ALERT_WEBHOOK`).

### 2.2 Los avisos al teléfono no llegan

**Qué pasa:** cada intento de aviso termina con el error "las llaves VAPID no están configuradas en producción". En el registro hay **66 intentos fallidos y ninguno exitoso** (el registro de avisos existe desde el 4 de noviembre). Hay 2 teléfonos suscritos. Solo hoy fallaron 50 avisos, por ejemplo el de un despacho cancelado.

**Causa:** el servidor de producción tiene 5 llaves configuradas y entre ellas no están las de los avisos. El guion antiguo de publicación (`deploy.sh`) las enviaba; la publicación automática actual (GitHub) no.

**Efecto:** quien dependa del aviso en el teléfono para enterarse de un despacho aprobado, cancelado o de un mensaje del buzón, no se entera. Los avisos dentro de la app abierta no dependen de esto.

**Arreglo:** agregar las dos llaves al servidor de Cloudflare y a la publicación automática. Las llaves existen en el archivo local de secretos. Riesgo bajo; requiere autorización porque es configuración de producción.

### 2.3 Una función de la base permite agregar deuda sin comprobar quién llama

**Qué es:** la base de datos tiene funciones (pequeños programas) que la app puede llamar. Supabase avisa de 35 que se pueden llamar **sin iniciar sesión**. Revisé cada una: la mayoría comprueba por dentro quién es el operador y qué rol tiene, así que están protegidas. Dos no comprueban nada:

| Función | Qué hace | Riesgo |
|---|---|---|
| `registrar_cargo_cxc` (versión de 5 datos) | Agrega un cargo a la deuda de un cliente por cualquier monto, incluso negativo (que la reduciría) | **Alto.** Es dinero |
| `registrar_pago_comision` | Marca una comisión como pagada | Medio |

**Qué tan fácil es abusar:** hace falta conocer el identificador interno del cliente o de la comisión, que es una clave larga y aleatoria. Un extraño no la tiene. **Cualquier persona con acceso al sistema sí puede verla**, y podría llamar la función saltándose los permisos de su rol.

**Cómo lo sé:** leí la definición de ambas funciones y sus permisos en producción. **No las ejecuté**, porque escriben datos reales.

**Arreglo:** quitarles el permiso de ejecución. **La app no usa ninguna de las dos** (lo busqué en todo el código), así que cerrarlas no rompe nada. Es un cambio en la base de datos: va con respaldo, primero en staging, y con autorización.

**Relacionado (ya conocido, sigue pendiente):** Supabase marca como error 3 vistas que se saltan las reglas de permisos (`v_productos_vendedor`, `v_cotizaciones_vendedor`, `v_catalogo_publico`). No analicé qué expone cada una.

## 3. Problemas medianos

### 3.1 Al aprobar un despacho a crédito, la deuda se anota en un paso aparte que puede fallar en silencio

Cuando administración aprueba un despacho, el servidor cambia el estado y **después** anota el cargo en la cuenta del cliente. Si ese segundo paso falla (un corte de red de un instante), el despacho queda aprobado, la deuda no se anota y el código lo deja pasar con el comentario "no crítico". El error solo se escribe en un registro interno de Cloudflare que hoy no se guarda.

**¿Ya pasó?** Lo comprobé en los datos: de **211 despachos a crédito y 97 de cobro a destino, ninguno quedó sin su anotación**. Es un riesgo latente, no un daño ocurrido.

**Por qué importa igual:** es justo el tipo de fallo que el vigilante de saldos (2.1) no detecta, porque el saldo y el historial coinciden: a los dos les falta el cargo.

**Arreglo:** que el cargo se anote en la misma operación que el cambio de estado, como ya se hace con la entrega y con el inventario. Toca dinero: staging y pruebas completas. Mientras tanto, activar el guardado de registros del servidor (una línea de configuración) para que estos errores al menos queden visibles.

### 3.2 La prueba nocturna de staging nunca ha pasado

La prueba automática de punta a punta sobre la copia de pruebas lleva **77 ejecuciones y 77 fallos** (desde el 29 de agosto). Falla en el paso que revisa la continuidad del historial de inventario. En la práctica no hay una red de seguridad automática que avise si un cambio rompe un flujo completo. No investigué la causa de fondo.

### 3.3 Comisiones con inconsistencias (pocas y pequeñas, salvo una)

| Despacho | Qué pasa | Monto |
|---|---|---|
| #1898 | Está **anulado** pero su comisión sigue "pendiente" de pago | $170,64 |
| #2121 | La parte liberada ($5,27) es mayor que el total de la comisión ($4,33) | $0,94 de más |
| #4020 y #4179 | Las partes suman 1 centavo más que el total | $0,01 cada una |
| 1 despacho entregado en los últimos 30 días | No tiene comisión generada | No identifiqué cuál |

La #1898 conviene revisarla antes del próximo pago de comisiones.

### 3.4 Inventario: 31 productos con existencia negativa

De 474 productos, 31 (todos activos) tienen existencia por debajo de cero; el peor, −110. Si el negocio permite vender sin existencia registrada, es esperado; pero significa que **para esos productos el inventario del sistema no refleja el almacén**. Conviene que Administración diga si es intencional.

### 3.5 Despachos viejos que nunca se cerraron

| Qué | Cuántos | Monto |
|---|---|---|
| Despachos "pendientes" con más de 30 días | 94 (85 son de mayo) | Unos $88.000 |
| De esos, sin ningún artículo | 26 (del 5 al 7 de mayo) | $16.698 |
| "Despachados" sin entregar desde hace más de 30 días | 3 (el más viejo, del 25 de julio) | — |

Parecen restos de la carga inicial o de pruebas, pero no lo puedo afirmar. Pueden inflar cualquier cifra de "pendientes". Requiere confirmación de Administración antes de anular nada.

## 4. Lo que está bien (comprobado hoy)

| Comprobación | Resultado |
|---|---|
| Saldo de cada cliente contra su historial (deuda y saldo a favor) | **0 diferencias** en 1.206 clientes |
| Comisiones duplicadas, huérfanas o con pagos imposibles | 0 |
| Despachos con número repetido | 0 |
| Cotizaciones con dos despachos vivos | 0 |
| Clientes con saldo negativo | 0 |
| Reversiones de inventario sin rastro en auditoría (7 días) | 0 |
| Entrega, reversa e inventario al aprobar | Ya se guardan en una sola operación y a prueba de doble clic |
| Errores de pantalla registrados | Ninguno desde el 21 de octubre |
| Errores en las llamadas al servidor (mediciones desde el 7/11) | 0 |
| Pruebas automáticas | 1.095 pasan |

Los descuadres que aparecieron entre el total de un despacho y la suma de sus artículos (11 casos) son todos despachos con devoluciones. Es esperado, no un error.

## 5. Asuntos menores

- **Búsquedas que fallan con coma o paréntesis.** En Movimientos de inventario y en el buscador de clientes de Auditoría, el texto escrito va directo a la consulta. Escribir, por ejemplo, "Pérez, C.A." hace fallar la búsqueda. Posiblemente también en la búsqueda por notas de Despachos.
- **Corte silencioso a 1.000 filas.** La base entrega como máximo 1.000 filas por consulta. Un vendedor ya tiene 1.001 despachos, así que buscar despachos por su nombre deja fuera al menos uno. La tabla de cuentas por cobrar tiene 992 filas y está por cruzar ese límite. No revisé todas las pantallas una por una.
- **Sesiones de PIN que nunca se borran.** Hay 3.119 guardadas y 3.066 ya vencidas. No hay limpieza automática. Hoy no afecta; crece sin límite.
- **Guardado sin conexión.** La cola que debería reenviar ventas hechas sin internet busca la sesión donde no está y no envía el PIN, así que no funcionaría. Prioridad baja: el sistema requiere internet. Lo deduje leyendo el código; no lo probé.
- **Errores del servidor que no quedan guardados.** El servidor escribe 77 tipos de error solo en la consola de Cloudflare, que no se conserva. Por eso un fallo como el de 3.1 pasaría sin dejar rastro.
- **Revisión automática de código (ESLint): 195 avisos.** Los que examiné son de estilo y no fallos de funcionamiento. No revisé los 195.
- **Supabase:** la protección contra contraseñas filtradas está desactivada, y 19 funciones no fijan su ruta de búsqueda (endurecimiento recomendado).

## 6. Orden sugerido

| Orden | Qué | Quién | Riesgo de arreglarlo |
|---|---|---|---|
| 1 | Cerrar las dos funciones abiertas (2.3) | Yo, con tu autorización; staging primero | Bajo: la app no las usa |
| 2 | Renovar la llave del vigilante de saldos (2.1) | Tú creas la llave; yo te guío | Ninguno |
| 3 | Poner las llaves de avisos en producción (2.2) | Yo, con tu autorización | Bajo |
| 4 | Guardar los registros de error del servidor | Yo | Muy bajo |
| 5 | Revisar comisión del despacho anulado #1898 (3.3) | Administración | — |
| 6 | Confirmar inventario negativo y despachos viejos (3.4, 3.5) | Administración | — |
| 7 | Anotar la deuda en la misma operación que la aprobación (3.1) | Yo; staging y pruebas completas | Medio: toca dinero |
| 8 | Arreglar la prueba nocturna de staging (3.2) | Yo | Bajo |

## 7. Límites de esta auditoría

- No es una lectura completa del código. Reportes, PDF, comisiones por dentro y las pantallas grandes no se leyeron línea por línea.
- No se probó ningún flujo en el navegador en esta revisión.
- No se ejecutó ninguna función que escriba datos; el hallazgo 2.3 se basa en la definición y los permisos.
- Las revisiones de datos reflejan el estado de hoy; no dicen si hubo descuadres en estos dos meses que ya se corrigieron.

## 8. Detalle técnico (para quien continúe)

- Vigilante: `.github/workflows/auditor-saldos-main.yml` → `scripts/auditor-saldos-main.mjs`; error `Management API 401: Invalid access token`; último éxito 2026-09-11; 64 de 65 ejecuciones fallidas.
- E2E staging: `.github/workflows/staging-e2e-nightly.yml`; paso que falla: "Auditar continuidad y provenance del Kardex"; 77 de 77.
- Push: `api/lib/webpush.js:54`; `wrangler secret list` devuelve `DEV_SUPER_CODE, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_URL`. Faltan `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`. `deploy-worker.yml` no las configura; `deploy.sh` sí las pasaba. `GROQ_KEYS_*` tampoco están, pero `groqFetch` no tiene llamadas en el código.
- Funciones `SECURITY DEFINER` ejecutables por `anon` sin comprobación interna de identidad: `public.registrar_cargo_cxc(uuid, uuid, numeric, text, uuid)` y `public.registrar_pago_comision(uuid, uuid, uuid)`. Sin usos en `src/`, `api/` ni `worker.js`. Arreglo: `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`.
- Cargo CxC al aprobar: `api/handlers/despachos.js`, bloque "5. Al aprobar (despachada)" (líneas ~1187-1362): `POST cuentas_por_cobrar` sin revisar la respuesta, dentro de un `try/catch` que solo hace `console.error`. `wrangler.toml` no tiene `[observability]`.
- Comisiones: C1 = 2 (#4020, #4179), C2 = 1 (#2121), W1 = 1, W2 = 1 (#1898), C3/C4/C5 = 0, W4 = 0.
- Datos: `productos.stock_actual < 0` → 31; `notas_despacho` pendientes > 30 días → 94; `operator_sessions` 3.119 (3.066 vencidas); máximo de despachos por vendedor 1.001; `cuentas_por_cobrar` 992 filas.
- Búsquedas sin sanear: `src/hooks/useMovimientosInventario.js:33`, `src/views/AuditoriaView.jsx:700`, `src/hooks/useDespachos.js:119`. Existe `sanitizePostgrestSearch` en `src/utils/format.js`.
- Cola sin conexión: `src/sw.js` (`processMutationQueueInSW`) lee el token con `idb-keyval` y no envía `X-Operator-Id` ni `X-Operator-Session`.
