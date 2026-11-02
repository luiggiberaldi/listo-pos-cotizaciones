# Plan de optimización de velocidad (solo cambios de bajo riesgo)

**Fecha:** 2026-11-02 · **Estado:** plan aprobado en alcance, pendiente de ejecutar.

## En resumen

Ya se publicó la primera mejora: al abrir el sistema se descarga un 40 % menos (421 KB → 252 KB). Lo que más molesta hoy es **cambiar de pantalla y guardar/confirmar**, y eso casi no depende del peso de los archivos: depende de **cuántos datos se piden y cuántas consultas se hacen**. Por eso el plan empieza **midiendo** (para no tocar a ciegas) y deja para después las mejoras de datos, que son de riesgo medio.

Alcance acordado con el dueño: **solo cambios de bajo riesgo ahora**. Las consultas y los PDF quedan para una segunda etapa, con medición antes y después y pruebas en staging.

## Lo verificado antes de planear

| Hallazgo | Detalle |
|---|---|
| 3 imágenes sin uso en el repositorio | `Diseño sin título (57).png` (8 MB), `diseno-sin-titulo.png` (1,4 MB), `favicon - copia.png`. Ningún archivo del código las usa. Se publican en cada despliegue. Autorizado borrarlas (quedan en el historial de git). |
| Ícono de la app | `pwa-icon.png`: 512×512 pero pesa 305 KB. Se puede dejar en unos 40-60 KB sin cambiar cómo se ve. |
| Logo de la lista de precios | 2000×2000 px y 1,4 MB; sale incluso dentro de cada PDF de lista de precios. Un logo de cabecera no necesita esa resolución. **Etapa 2** (cambia cómo salen los PDF). |
| Otros logos de PDF | 1024×1024 (216 KB, dos veces) y 400×400 (90 KB). |
| Consultas que piden todas las columnas (`select *`) | 15 archivos. **Etapa 2**: se revisan una por una. |
| Datos en memoria | Ya se reutilizan 5 minutos y no se piden al cambiar de pestaña. Está bien. |
| Pantallas | Cada una ya se descarga solo al abrirla. Está bien. |
| Guardar/confirmar | Los procesos del servidor hacen muchas llamadas seguidas a la base (despachos: ~106 puntos de llamada; cotizaciones: ~31; inventario: ~21). Es la zona más probable del "se siente lento al guardar", pero **no está medido**. |

## Etapa 0 — Medir (sin riesgo, primero)

Sin números no sabemos qué pantallas y qué guardados son los lentos. Propuesta:

1. Registrar el tiempo que tarda cada pantalla en mostrar datos y cada guardado importante, en el navegador y en el servidor (solo tiempos, sin datos de clientes).
2. Dejarlo uno o dos días de uso normal.
3. Ordenar los 10 casos más lentos. Con eso se decide la etapa 2 con cifras y no con intuición.

## Etapa 1 — Cambios de bajo riesgo (se pueden hacer ya)

| # | Cambio | Beneficio | Cómo se verifica |
|---|---|---|---|
| 1 | Borrar las 3 imágenes sin uso | Cada despliegue publica 9,4 MB menos | Compilar y confirmar que no falta nada |
| 2 | Achicar `pwa-icon.png` conservando 512×512 | Instalación de la app más liviana | Comparar visualmente el ícono |
| 3 | Aviso discreto "Hay una versión nueva" cuando se aplaza la actualización por sesión activa | Los equipos que nunca cierran sesión se actualizan antes, sin sacar a nadie | Prueba en Chrome como la del login |
| 4 | Medición (etapa 0) | Datos reales para decidir | Revisar el registro tras 1-2 días |

Cada cambio va en su propio PR pequeño, con compilación y pruebas, y se publica solo.

## Etapa 2 — Después de medir (riesgo medio, requiere pruebas en staging)

- Consultas más específicas en las pantallas que salgan lentas en la medición.
- Reducir llamadas seguidas en los guardados más lentos (agruparlas en una sola operación, como ya se hizo con la actualización masiva de precios).
- Logos de PDF más livianos, comparando cómo salen antes y después.
- Revisar índices de la base de datos para las búsquedas más usadas.

Esta etapa no empieza sin ver los resultados de la etapa 0 y sin la aprobación del dueño.

## Reglas de seguridad del plan

- Un cambio por PR, con vuelta atrás simple.
- Nada que toque datos o la base de datos en la etapa 1.
- Medir antes y después y reportar la diferencia en cifras.
- Producción solo con autorización del dueño; lo que toque la base de datos pasa primero por staging.

## Avance (2026-11-02)

- Publicado: PR #5/#6 (librería de PDF bajo demanda, −40 % de carga inicial), PR #7 (3 imágenes sin uso borradas, ícono de 305 KB a 46 KB), PR #8 (aviso de versión nueva).
- Medición (etapa 0): cada llamada al servidor registra ruta (sin ids ni parámetros), método, tiempo y estado. Cada 5 minutos (y al ocultar la pestaña) se envía **un resumen** a los logs del sistema con categoría `RENDIMIENTO` (nivel info). Se consulta en la tabla `system_logs`. No guarda datos de clientes.
- Siguiente paso: dejar correr 1-2 días y sacar el ranking de las rutas más lentas (p95) para decidir la etapa 2.
