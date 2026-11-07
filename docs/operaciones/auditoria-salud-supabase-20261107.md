# Auditoría de salud de Supabase (producción) — 7 nov 2026

Proyecto: `oyfyuszgjwcepjpngclv` ("listopos cotización"), que es el de **producción**.
Solo se hicieron lecturas; no se cambió nada.

## En resumen

- **Salud general: buena.** El servidor no está sufriendo. La base de datos responde desde
  memoria el 99,99 % de las veces y no hay bloqueos ni errores de salud.
- **Velocidad:** hay 3–4 búsquedas que tardan entre 0,4 y 1,9 segundos (buscar despachos,
  cotizaciones y productos). Esas son las que los usuarios notarían como "lento".
- **Seguridad:** no hay nada roto, pero hay una lista de "puertas" que conviene cerrar
  poco a poco (detalle abajo). Ninguna es una emergencia.
- El bajón de memoria al final del gráfico se debe a que **el servidor se reinició** el
  7 nov a las 01:36 UTC (≈ 21:36 hora de Venezuela del 6 nov).

## 1. Recursos del servidor

| Qué | Valor | Lectura |
|---|---|---|
| Datos respondidos desde memoria (caché) | 99,99 % | Excelente. Casi nunca tiene que ir al disco. |
| Conexiones abiertas | 32 de 60 permitidas | Normal. Solo 2 trabajando en ese momento. |
| Bloqueos mutuos (deadlocks) | 0 | Perfecto. |
| Tamaño de los datos | 56 MB | Muy pequeño. |
| "Cuaderno de cambios" (WAL) retenido por Realtime | 15 MB, conectado | Sano: el servicio de avisos en vivo está leyendo al día. |
| Alertas de salud de Supabase | Ninguna | ✅ |

La memoria al 70 % es normal: Postgres reserva memoria a propósito para guardar los datos
más usados.

## 2. Qué consume más trabajo

Desde el reinicio (~13 horas):

1. **Realtime** (avisos en vivo a las pantallas): ~34.000 consultas, 265 s en total, 7,7 ms
   cada una. Es el que más trabaja, pero cada consulta es rapidísima. Normal.
2. **Búsqueda de despachos por texto**: ~1,5 s por búsqueda (máx. 1,9 s).
3. **Lista/búsqueda de cotizaciones**: ~1,4 s por consulta (máx. 1,8 s).
4. **Lista de productos**: ~0,4 s por consulta.
5. **Pesos de despacho**: ~0,1 s por consulta (máx. 0,45 s).

Los puntos 2–4 son candidatos para la próxima etapa del plan de velocidad.

## 3. Alertas de rendimiento de Supabase

| Alerta | Cantidad | Qué significa |
|---|---|---|
| Reglas de permisos que se recalculan fila por fila (`auth_rls_initplan`) | 52 | Ya se está trabajando en esto (archivos `301_rls_initplan_fase4a*.sql` en staging). |
| Varias reglas de permiso para la misma acción (`multiple_permissive_policies`) | 242 | Cada consulta revisa varias reglas en vez de una. Hace más lento todo un poco. |
| Índices sin usar (`unused_index`) | 95 | Índices = "fichas de búsqueda" que nadie usa. Ocupan espacio y hacen un poco más lenta cada escritura. Revisar con calma (el contador se reinició hace 13 h, así que puede dar falsos positivos). |

## 4. Alertas de seguridad

| Gravedad | Alerta | Cantidad | Riesgo real |
|---|---|---|---|
| ERROR | Vistas que ignoran los permisos del usuario (`security_definer_view`) | 3 | `v_productos_vendedor`, `v_cotizaciones_vendedor`, `v_catalogo_publico`. Revisar que no muestren datos de más. |
| AVISO | Funciones ejecutables sin iniciar sesión | 35 | La mayoría tiene chequeo interno o son "disparadores" que no se pueden llamar a mano. Sin chequeo visible: `obtener_stock_productos` (muestra nombre y stock si se conoce el ID), `obtener_categorias_vendedor`, `tiene_gate_configurado`, `validar_gate_acceso` (esta última es de la pantalla de acceso, es normal que sea pública). |
| AVISO | Funciones sin `search_path` fijo | 19 | Buena práctica de seguridad; arreglo sencillo. |
| AVISO | Protección contra contraseñas filtradas desactivada | 1 | Se activa con un interruptor en el panel de Supabase (Auth → Passwords). |
| AVISO | Extensión `vector` en el esquema público | 1 | Bajo riesgo. |
| INFO | Tablas con seguridad activa pero sin reglas | 10 | Significa "nadie puede leerlas desde la web", solo el servidor. Normalmente intencional. |

Nota: la columna "chequeo interno" se determinó buscando palabras clave en el código de
cada función; es una revisión rápida, no una auditoría línea por línea.

## 5. Recomendaciones, en orden

1. ~~Terminar la fase de permisos (`initplan`)~~ ✅ Aplicada en producción el 7/11/2026 (6,8× más rápido). Ver plan-optimizacion-velocidad-20261106.md.
2. Acelerar las búsquedas de despachos y cotizaciones (1,4–1,9 s).
3. Activar la protección de contraseñas filtradas (un clic).
4. Revisar las 3 vistas marcadas como ERROR.
5. Quitar el acceso sin sesión a `obtener_stock_productos` y `obtener_categorias_vendedor`
   si la app no los usa antes del inicio de sesión.
