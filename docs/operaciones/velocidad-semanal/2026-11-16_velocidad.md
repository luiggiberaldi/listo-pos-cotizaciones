# Informe semanal de velocidad — lunes 16 de noviembre de 2026

**Semana medida:** lunes 9 al domingo 15 de noviembre (hora de Venezuela) · **Comparada con:** 2 al 8 de noviembre y con la línea base (2 al 7 de noviembre, antes de las mejoras) · **Tipo:** tarea automática, solo lectura (caso [OP-2026-029](../OP-2026-029_informe-semanal-velocidad.md)) · **Primera edición** de este informe.

---

## En resumen

🟢 **Más rápido.** La pantalla de clientes tarda lo típico **1,20 s** (antes 1,74 s) y la configuración **0,82 s** (antes 1,15 s): **unos 30 % menos**. Desde que se publicó OP-2026-021 (noche del 10/11) baja aún más: **1,05 s** y **0,77 s**.
**Cero errores** en todas las pantallas medidas (la semana anterior hubo 9). Lo más lento que queda: **cambiar el estado de un despacho (1,4 s)** y **la lista de cotizaciones de cada vendedor (~1 s dentro de la base de datos)**.

**Recomendación (una sola):** revisar en staging por qué la lista de cotizaciones del vendedor tarda ~1 s en la base, cuando la misma lista sin filtrar por vendedor tarda 0,3 s. Detalle al final.

---

## Cómo leer las tablas

- **Típico (p50):** lo que tarda la mitad de las veces. Es la cifra que mejor describe "cómo se siente".
- **Peor caso (p95):** lo que tarda 1 de cada 20 veces. Suele subir por mala señal o un teléfono que "despierta".
- **Reparto del tiempo** (solo para las llamadas al servidor, `/api/...`). Piensa en un pedido por teléfono a un almacén:
  - **Internet:** el viaje de ida y vuelta entre el teléfono/PC del usuario y el servidor.
  - **Verificación:** el portero comprobando la cuenta y el PIN.
  - **Consulta de cuenta:** parte de la verificación en la que el portero llama a la central para confirmar la cuenta (cuando no la tiene anotada en su libreta, "caché").
  - **Base y lógica:** buscar y preparar los datos en el almacén (la base de datos).
- Las restas son aproximadas (se restan medianas).
- ⚠️ = menos de ~50 llamadas: la cifra es orientativa, no sacar conclusiones.

---

## 1. Volumen de uso

| | Semana anterior (2–8 nov) | Esta semana (9–15 nov) |
|---|---|---|
| Resúmenes enviados (uno cada 5 min por navegador abierto) | 862 | 1.404 |
| Llamadas al servidor (`/api/...`) | 2.355 | 2.416 |
| Consultas directas a la base (`db:...`) | — (no se medían) | 9.381 (desde el 11/11) |
| Operadores distintos | 8 | 9 |

- **El uso real fue parecido** las dos semanas (≈2.400 llamadas al servidor). El salto en "llamadas totales" (11.797) es solo porque desde el 11/11 también se miden las consultas directas a la base.
- **Días con más movimiento:** jueves 13 y miércoles 11. Sábado 14 a media jornada; domingo casi nada.
- **Horas pico:** de **9 a 11 a. m.** (máximo a las 10) y otra vez de **2 a 3 p. m.**

## 2. Lo más usado del servidor (antes / ahora y reparto del tiempo)

Típico en milisegundos (1.000 ms = 1 segundo). "Desde OP-021" = desde la noche del 10/11, cuando se publicaron las mejoras de velocidad.

| Pantalla / acción | Llamadas (ant → act) | Línea base | Semana anterior | **Esta semana** | Desde OP-021 | Peor caso esta semana | Errores | Internet | Verificación | …consulta de cuenta | Base y lógica |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ver clientes (`GET /api/clientes`) | 1.213 → 1.149 | 1.802 | 1.744 | **1.201** | 1.048 | 38,8 s (ver §5) | 0 | ~430 | 329 | 188 | ~440 |
| Configuración (`GET /api/config`) | 604 → 677 | 1.209 | 1.151 | **820** | 767 | 9,9 s | 0 | ~335 | 333 | 195 | ~150 |
| Cambiar estado de despacho | 185 → 221 | 2.452 | 2.465 | **1.694** | 1.424 | 7,9 s | 0 (antes 4) | ~280 | 342 | 198 | ~1.070 |
| Crear despacho | 53 → 76 | 1.997 | 2.034 | **1.317** | 1.187 | 3,0 s | 0 (antes 1) | ~265 | 217 | 136 | ~835 |
| Comprobar RIF ⚠️ | 24 → 37 | 1.553 | 1.501 | **861** | 793 | 1,9 s | 0 | ~320 | 389 | 232 | ~150 |
| Enviar aviso (push) ⚠️ | 23 → 36 | 1.155 | 1.100 | **777** | 795 | 1,5 s | 0 | ~220 | 199 | 139 | ~355 |
| Actualizar producto ⚠️ | 11 → 33 | 1.368 | 1.368 | **803** | 781 | 1,5 s | 0 | ~195 | 329 | 222 | ~280 |
| Crear cliente ⚠️ | 21 → 31 | 1.264 | 1.244 | **882** | 831 | 1,5 s | 0 | ~245 | 298 | 165 | ~340 |
| Editar pago de despacho ⚠️ | 26 → 26 | 2.155 | 2.169 | **1.409** | 1.356 | 2,3 s | 0 (antes 2) | ~195 | 290 | 163 | ~920 |
| Resumen de cobranza ⚠️ | 19 → 25 | 1.019 | 950 | **833** | 813 | 1,4 s | 0 | ~210 | 270 | 167 | ~355 |
| Préstamos de clientes ⚠️ | 14 → 20 | 1.039 | 983 | **770** | 690 | 1,8 s | 0 | ~230 | 370 | 229 | ~170 |
| Reporte de transportistas ⚠️ | 21 → 15 | 1.663 | 1.476 | **1.400** | 776 | 7,0 s | 0 | ~320 | 248 | 410 | ~830 |
| Resumen financiero de despachos ⚠️ | 17 → 13 | 1.160 | 1.160 | **614** | 613 | 0,8 s | 0 | ~200 | 265 | 129 | ~150 |
| Movimiento de inventario ⚠️ | 1 → 10 | 1.582 | 1.582 | **921** | 995 | 1,6 s | 0 | ~195 | 408 | 187 | ~320 |
| Abono a cuenta por cobrar ⚠️ | 4 → 9 | 2.477 | 2.477 | **1.283** | 1.340 | 1,6 s | 0 | ~215 | 380 | 218 | ~690 |

**Lectura:** todas las acciones bajaron entre 15 % y 50 %. Ninguna de las 15 más usadas empeoró.

**La "consulta de cuenta" sigue ocurriendo en ~72 % de las llamadas** (1.742 de 2.416): el portero todavía llama a la central casi siempre (~0,13–0,23 s cada vez). Era la recomendación n.º 1 del informe del 10/11 y sigue pendiente.

**Efecto de la "ubicación inteligente" del servidor (OP-2026-021, B3).** Comparando los días 7–10/11 (antes) con 11–15/11 (después), el tiempo **dentro del servidor** bajó:

| Acción | Servidor antes → después | Típico antes → después |
|---|---|---|
| Ver clientes | 857 → 679 ms | 1.323 → 1.048 |
| Configuración | 534 → 445 | 866 → 767 |
| Cambiar estado de despacho | 1.752 → 1.188 | 2.053 → 1.424 |
| Crear despacho | 1.297 → 911 | 1.632 → 1.187 |

Es la primera medición real del efecto: **funcionó** (entre 0,1 y 0,6 s menos por acción). No se puede separar del todo de otras causas (por ejemplo, menos carga algún día), pero la bajada es pareja en las cuatro acciones.

## 3. Consultas directas a la base (`db:...`) — medidas desde el 11/11

Son las búsquedas que la app hace directamente a la base de datos, sin pasar por el servidor.

**Las 15 más usadas**

| Consulta | Llamadas | Típico | Peor caso ponderado | Peor caso máximo | Errores |
|---|---|---|---|---|---|
| usuarios | 1.948 | 306 | 540 | 14,5 s | 0 |
| notas de despacho | 1.514 | 514 | 761 | 9,7 s | 0 |
| productos | 1.485 | 473 | 771 | 13,0 s | 0 |
| productos del vendedor (función) | 820 | 595 | 726 | 14,8 s | 0 |
| pesos de despachos | 749 | 405 | 551 | 14,5 s | 0 |
| **cotizaciones** | 708 | **674** | **1.433** | 7,7 s | 0 |
| artículos de despachos | 642 | 344 | 462 | 6,0 s | 0 |
| cuentas por cobrar | 320 | 376 | 577 | 7,0 s | 0 |
| transportistas | 277 | 519 | 531 | 4,0 s | 0 |
| artículos de cotizaciones | 249 | 362 | 411 | 1,4 s | 0 |
| buzón de sugerencias | 217 | 503 | 514 | 13,5 s | 0 |
| categorías del vendedor (función) | 192 | 483 | 548 | 14,7 s | 0 |
| stock de productos (función) | 97 | 260 | 273 | 0,8 s | 0 |
| artículos con peso ⚠️ | 53 | 284 | 315 | 0,7 s | 0 |
| clientes ⚠️ | 40 | 785 | 922 | 6,9 s | 0 |

**Las 10 más lentas (típico)**

| Consulta | Llamadas | Típico | Errores |
|---|---|---|---|
| configuración del negocio ⚠️ | 9 | 1.087 | 0 |
| reporte de ventas (función) ⚠️ | 18 | 1.076 | 0 |
| clientes ⚠️ | 40 | 785 | 0 |
| **cotizaciones** | 708 | **674** | 0 |
| productos del vendedor (función) | 820 | 595 | 0 |
| transportistas | 277 | 519 | 0 |
| notas de despacho | 1.514 | 514 | 0 |
| buzón de sugerencias | 217 | 503 | 0 |
| categorías del vendedor (función) | 192 | 483 | 0 |
| productos | 1.485 | 473 | 0 |

- **Cero errores** en las 9.381 consultas.
- **"usuarios" es la consulta más repetida** (1.948 veces, ~280 al día) aunque es rápida. Pedirla menos veces ahorraría tráfico, no mucho tiempo.
- **Cotizaciones** es la que más pesa: se usa mucho y su peor caso habitual (1,4 s) es el doble que el resto. Ver §6.

## 4. Lo más lento (cualquier uso)

**Top 10 por tiempo típico (servidor y base)**

| Acción | Llamadas | Típico esta semana | Semana anterior | Cambio |
|---|---|---|---|---|
| Reasignar cliente ⚠️ | 2 | 1.907 | 1.570 (1 llamada) | 🔺 +21 % (muestra mínima) |
| Devolución parcial ⚠️ | 2 | 1.733 | 3.821 | −55 % |
| Cambiar estado de despacho | 221 | 1.694 | 2.465 | −31 % |
| Guardar configuración (admin) ⚠️ | 2 | 1.670 | 756 (1 llamada) | 🔺 +121 % (muestra mínima) |
| Editar pago de despacho ⚠️ | 26 | 1.409 | 2.169 | −35 % |
| Reporte de transportistas ⚠️ | 15 | 1.400 | 1.476 | −5 % |
| Editar artículos de despacho ⚠️ | 9 | 1.357 | 2.426 | −44 % |
| Crear despacho | 76 | 1.317 | 2.034 | −35 % |
| Abono a cuenta por cobrar ⚠️ | 9 | 1.283 | 2.477 | −48 % |
| Transformación de inventario ⚠️ | 2 | 1.224 | 1.576 | −22 % |

Las dos marcadas 🔺 (empeoraron más de 15 %) tienen **1 o 2 usos** cada semana: no es una señal fiable, solo vigilar.

**Top 10 por peor caso (máximo de la semana)**

| Acción | Peor caso | Quién / cuándo |
|---|---|---|
| Ver clientes | 38,8 s | Edgar, 10/11 2:33 p. m. |
| Productos del vendedor | 14,8 s | Josué, 13/11 10:26 a. m. |
| Categorías del vendedor | 14,7 s | Josué, 13/11 10:26 a. m. (mismo momento) |
| Pesos de despachos | 14,5 s | Gabi, 11/11 5:26 p. m. |
| Usuarios | 14,5 s | Gabi, 11/11 5:26 p. m. (mismo momento) |
| Buzón de sugerencias | 13,5 s | Josué, 13/11 2:57 p. m. |
| Productos | 13,0 s | Gabi, 11/11 1:11 p. m. |
| Configuración | 9,9 s | Edgar, 09/11 3:32 p. m. |
| Notas de despacho | 9,7 s | Gabi, 11/11 5:26 p. m. (mismo momento) |
| Cambiar estado de despacho | 7,9 s | — |

**Por qué no es el servidor:** los peores casos llegan **en grupo, del mismo equipo y en el mismo minuto** (por ejemplo, Gabi a las 5:26 p. m.: cuatro consultas distintas lentas a la vez). Eso es típico de un teléfono que estaba en segundo plano o perdió señal, no de la base de datos (que en ese momento atendía bien a los demás).

## 5. Por operador (solo nombre de pila o rol)

| Operador | Llamadas | Típico servidor | Típico base | Ver clientes: típico / dentro del servidor | Peor caso máximo |
|---|---|---|---|---|---|
| Administrador | 5.006 | 1.145 | 419 | 1.090 / 763 | 10,9 s |
| **Edgar** | 1.756 | **1.304** | 410 | **1.707** / 832 | **38,8 s** |
| Josué | 1.688 | 959 | 523 | 1.076 / 721 | 14,8 s |
| Logística | 1.441 | 1.039 | 415 | 1.075 / 782 | 7,9 s |
| Niki | 1.098 | 950 | 522 | 1.153 / 746 | 4,7 s |
| Cuenta principal (sin operador de PIN) | 349 | 1.015 | 482 | 1.105 / 659 | 4,7 s |
| **Gabi** ⚠️ | 308 | 1.196 | **680** | 1.448 / 697 | 14,5 s |
| Enzo ⚠️ | 144 | 1.152 | 395 | 693 / 459 | 8,8 s |
| Empresa ⚠️ | 7 | 1.015 | — | 1.243 / 1.095 | 1,4 s |

- **Edgar** tiene la conexión más lenta: en "ver clientes" el servidor tarda lo mismo que para los demás (~0,8 s), pero a él le llega en 1,7 s. Esos **~0,9 s de diferencia son su internet** (los demás pierden ~0,35 s). A las 2 p. m. su típico sube a 5 s. Vale la pena preguntar desde dónde trabaja a esa hora (¿datos móviles, zona con mala señal?).
- **Gabi** también va algo lenta en las consultas a la base (0,68 s frente a ~0,42 s del resto), con pocos datos.
- Los vendedores (Josué, Niki, Gabi) tienen consultas a la base más lentas que administración y logística (~0,52 s frente a ~0,42 s). Coincide con lo de las cotizaciones del vendedor (§6).
- La semana anterior casi todo quedaba a nombre de la cuenta principal, porque hasta el 07/11 los registros no se guardaban a nombre del operador del PIN. Por eso no se compara operador por operador con la semana anterior.

## 6. Por hora del día (esta semana)

| Hora | Llamadas | Típico servidor | Típico base | Ver clientes |
|---|---|---|---|---|
| 8 a. m. | 520 | 1.108 | 413 | 1.110 |
| 9 a. m. | 1.306 | 1.047 | 472 | 1.032 |
| **10 a. m. (pico)** | 2.304 | 1.038 | 428 | 1.095 |
| 11 a. m. | 1.807 | 988 | 423 | 1.058 |
| 12 m. | 1.266 | 901 | 391 | 978 |
| 1 p. m. | 722 | 1.157 | 447 | 1.294 |
| **2 p. m.** | 1.232 | **1.391** | 500 | **1.845** |
| 3 p. m. | 1.389 | 1.256 | 407 | 1.248 |
| 4 p. m. | 825 | 1.024 | 543 | 1.061 |
| 5 p. m. | 254 | 1.243 | 865 | 1.257 |
| Noche (6–10 p. m.) ⚠️ | 150 | 1.000–2.800 | ~520 | — |

- **La hora pico de la mañana no se pone lenta:** a las 10 a. m., con el doble de uso, los tiempos son iguales a los de las 8. La base aguanta bien la carga.
- **Las 2 p. m. sí son más lentas**, pero casi todo es Edgar (su típico en clientes a esa hora: 5 s). Sin él, esa franja queda en ~1,2 s.

## 7. Errores y avisos

- **Errores en pantallas y consultas medidas: 0** (semana anterior: 9 — cambiar estado 4, editar pago 2, crear despacho 1, editar artículos 1, ver clientes 1).
- **Registros de "tiempo agotado", red o conexión: 0.**
- **Aviso nuevo, no relacionado con velocidad:** 138 avisos de **notificaciones (push) que no llegaron** esta semana (la anterior, 14). Casi todos dicen "0 enviadas bien, 1 con error, 0 retiradas": parece **un mismo teléfono cuya suscripción ya no sirve y que no se está retirando**, así que el sistema lo reintenta cada vez. No afecta la velocidad, pero alguien podría estar sin recibir avisos. Se anota para revisarlo aparte.
- Tareas automáticas nocturnas (limpieza de cotizaciones, purga de imágenes): normales, 28 registros.

## 8. La base de datos por dentro

| Medida | Valor | Lectura |
|---|---|---|
| Datos servidos desde memoria (caché) | 100 % (tablas e índices) | Excelente: casi nada se lee del disco |
| Conexiones | 2 activas, 19 en espera, de 60 posibles | Muy holgado |
| Tamaño total | 58 MB | Pequeño |
| Registro de mediciones (`system_logs`) | 2,4 MB; ~230 filas por día laboral | Crece despacio; sin problema por ahora |
| Filas "muertas" (restos de cambios que esperan limpieza) | La más alta: sesiones de operador 13 %, productos 17 %, ambas con pocas filas | Ninguna necesita limpieza manual |

**Tablas más grandes:** auditoría (11 MB, con solo 696 filas: guarda registros muy largos), movimientos de inventario (4,2 MB), operaciones de inventario (3,1 MB), notas de despacho (2,9 MB), artículos de cotización (2,6 MB). No hay historial anterior para calcular crecimiento; a partir del próximo informe se podrá comparar.

**Consultas más pesadas dentro de la base** (registradas desde el 07/11; solo el inicio, sin valores):

| Consulta | Veces | Tiempo medio | Tiempo total | Lectura |
|---|---|---|---|---|
| **Lista de cotizaciones filtrada por vendedor** (con seguimiento, orden por última actualización) | 505 | **1.036 ms** (máx. 2,2 s) | 523 s | **La que más tiempo consume en total.** La misma lista sin filtro de vendedor tarda **318 ms** |
| `explain (analyze) select count(*)` de auditoría, cotizaciones, inventario… | 60 cada una | 400–2.000 ms | ~330 s en total | Conteos de diagnóstico (no son pantallas de usuarios); origen sin confirmar |
| Prueba de permisos (`get_rol_actual`…) | 16 | 7.078 ms | 113 s | Consulta de diagnóstico de auditorías anteriores, no de usuarios |
| Pesos de despachos | 1.859 | 58 ms | 108 s | Rápida, solo muy usada |
| Búsqueda de notas de despacho (dos variantes) | 217 / 1.165 | 466 / 83 ms | 101 / 97 s | La variante de 466 ms merece mirarse después de cotizaciones |
| Lista de clientes (desde el servidor) | 3.256 | 18 ms | 59 s | Rápida: el tiempo de "ver clientes" no está en la base |
| Nombres de zonas horarias | 24 | 636 ms | 15 s | Interna de Supabase, ignorar |

**Avisos de rendimiento de Supabase:** **no se pudieron leer** — la herramienta respondió "You do not have permission to perform this action" (sin permiso).

## 9. Carga de la página

Las mediciones actuales **no incluyen** el tiempo de la carga inicial de la app ni del cambio entre pantallas: solo llamadas al servidor y consultas a la base. No se puede informar todavía.

---

## Qué cambió y por qué

Publicado en producción en los últimos 8 días (`git log origin/main` y [REGISTRO.md](../REGISTRO.md)):

| Fecha | Caso | Qué | ¿Afecta la velocidad? |
|---|---|---|---|
| 10/11, 8:18 p. m. | [OP-2026-021](../OP-2026-021_velocidad-cambios-bajo-riesgo.md) (solicitud #48) | Servidor junto a la base, precarga de pantallas, reloj aparte, medición de consultas a la base | **Sí.** Explica la bajada del 11/11 en adelante (§2) y que ahora existan las mediciones `db:...` |
| 10/11 | OP-2026-022 y OP-2026-024 (solicitudes #50 y #52) | Arreglos de los PDF | No |
| 14/11 | OP-2026-026 y OP-2026-027 (solicitudes #54 y #56) | Comisiones: confirmación del designado, ventana y fecha | No |

La otra parte de la mejora (de 1,74 s a ~1,3 s en clientes) viene de los cambios del 07/11 ([etapa 2](../etapa2-velocidad-20261107.md)), que en la semana anterior solo estuvieron activos el fin de semana.

---

## Recomendación (requiere aprobación del dueño)

**Un paso: acelerar la lista de cotizaciones de los vendedores.**

- **Qué pasa:** cuando un vendedor abre sus cotizaciones, la base tarda ~1 s en prepararlas (hasta 2,2 s). La misma lista sin el filtro "solo las mías" tarda 0,3 s. Algo en ese filtro —probablemente las reglas que deciden qué puede ver cada vendedor, o un índice que falta— hace el trabajo tres veces más largo. Es como si el almacenista, para darle al vendedor solo sus pedidos, revisara uno por uno todos los del almacén.
- **Qué se haría:** primero un diagnóstico en **staging** (la copia de pruebas) viendo cómo la base resuelve esa búsqueda como vendedor; después, el arreglo más pequeño posible (por ejemplo, un índice nuevo, que es como añadir un separador por vendedor al archivador).
- **Beneficio esperado:** que la lista de cotizaciones del vendedor baje de ~1 s a ~0,3–0,4 s en la base. Es la consulta que más tiempo total consume (523 s en 9 días), la usan a diario Josué, Niki y Gabi, y probablemente explica que sus consultas sean más lentas que las del resto.
- **Riesgo:** bajo-medio. **No toca dinero ni inventario**, pero sí la base de datos y quizá las reglas de permisos: debe probarse primero en staging, con las pruebas de permisos de vendedor, antes de producción.
- **Segundo en la fila (no ahora):** la consulta de cuenta que se repite en el 72 % de las llamadas (§2), ya recomendada el 10/11.

---

## Pendiente / no verificado

- **Avisos de rendimiento de Supabase:** sin permiso para leerlos con la herramienta. El dueño puede verlos en el panel de Supabase → *Advisors* → *Performance* del proyecto, o dar ese permiso a la conexión.
- **Carga inicial y cambio de pantallas:** no se mide todavía (§9).
- **Crecimiento de tablas:** sin historial; se podrá estimar desde el próximo lunes comparando con este informe.
- **Consultas directas a la base de la semana anterior:** no existían (empezaron el 11/11); no hay comparación.
- **Origen de los conteos de diagnóstico** (`explain analyze count(*)`, 60 por tabla): no confirmado; no vienen de pantallas de usuarios.
- **Notificaciones push fallidas** (138 en la semana): solo se resume aquí; requiere un caso aparte si el dueño quiere revisarlo.
- **"Mis ventas"** no se usó esta semana (la anterior 40 veces): no hay datos de su velocidad.
- **Registro de operaciones:** esta tarea solo escribe el informe y el índice; no agrega fila a [REGISTRO.md](../REGISTRO.md). El caso que la cubre es [OP-2026-029](../OP-2026-029_informe-semanal-velocidad.md), que puede marcarse como "primera ejecución hecha el 16-nov".

---

## Apartado técnico

- Ventanas (UTC): actual `2026-11-09 04:00` → `2026-11-16 04:00`; anterior `2026-11-02 04:00` → `2026-11-09 04:00`; línea base `ts < 2026-11-07 03:40`; "desde OP-021" `ts ≥ 2026-11-11 00:30`; comparación de Smart Placement: `2026-11-07 03:40` → `2026-11-11 00:18` frente a `2026-11-11 00:18` → `2026-11-16 04:00`.
- p50 ponderado por `n`; "peor caso ponderado" = p95 ponderado por `n`; "peor caso máximo" = máximo de los p95 de cada resumen. `srv`, `auth` y `cuenta` ponderados por `n` solo en resúmenes que traen el campo. `cuenta_p50` no aparece en el resumen cuando todas las llamadas estaban en caché: 1.742 de 2.416 llamadas `/api` lo traían.
- Consultas (todas solo SELECT, en `tmp/port-tools/`, ejecutadas con `node tmp/port-tools/q-prod-full.mjs <archivo>` contra producción, todas respondieron 200):
  - `semanal_20261116_cols.sql` — columnas de `system_logs`, rango y claves de `meta`.
  - `semanal_20261116_rutas.sql` → `semanal_20261116_rutas_out.json` — rutas por periodo.
  - `semanal_20261116_vol.sql` → `semanal_20261116_vol_out.json` — volumen, días, horas, operadores, antes/después de OP-021, caché de cuenta.
  - `semanal_20261116_err.sql` → `semanal_20261116_err_out.json` — errores, avisos y peores casos (mensajes con correos, identificadores y números largos reemplazados por `#`).
  - `semanal_20261116_db.sql` → `semanal_20261116_db_out.json` — caché, conexiones, tamaños, filas muertas.
  - `semanal_20261116_pgss.sql` y `semanal_20261116_cot.sql` — `pg_stat_statements` (reiniciado el 2026-11-07 01:36 UTC) e índices de `cotizaciones`.
- `get_advisors` (performance, proyecto `oyfyuszgjwcepjpngclv`): error `MCP error -32600: You do not have permission to perform this action`.
- Consulta lenta de cotizaciones: `WITH pgrst_source AS (SELECT cotizaciones.id, numero, version, … LEFT JOIN LATERAL (… seguimiento_operativo …) WHERE cotizaciones.vendedor_id = $7 ORDER BY actualizado_en DESC LIMIT $8 …)`. Índices existentes: `idx_cotizaciones_vendedor (vendedor_id)` e `idx_cotizaciones_actualizado_en (actualizado_en DESC)` por separado; no hay uno combinado `(vendedor_id, actualizado_en DESC)`. Falta confirmar con EXPLAIN en staging si el tiempo está en ese orden o en las reglas de permisos (RLS) de las tablas incluidas.
