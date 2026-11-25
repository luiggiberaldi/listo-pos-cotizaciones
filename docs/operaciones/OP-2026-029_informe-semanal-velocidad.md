# OP-2026-029 — Informe semanal de velocidad del sistema

**Fecha:** 2026-11-15 · **Estado:** tarea programada activa; primera ejecución hecha el 16-nov-2026 (10:50 a. m., porque la app se abrió tarde) · **Tipo:** revisión automática, solo lectura
**Relacionados:** [OP-2026-020](OP-2026-020_auditoria-velocidad-e2e.md) · [OP-2026-021](OP-2026-021_velocidad-cambios-bajo-riesgo.md) · [etapa 2](etapa2-velocidad-20261107.md)

## En resumen

- **Cada lunes a las 9 a. m.** una revisión automática mide qué tan rápido funcionó el sistema en producción durante la semana y la compara con la semana anterior.
- **Solo mira, no cambia nada.** Deja un informe con un semáforo (🟢 / 🟡 / 🔴) y **una** recomendación. Cualquier cambio sigue necesitando tu aprobación.
- **Por qué:** antes solo hubo dos revisiones sueltas (4 y 10 de noviembre). La que se propuso para el 13 de noviembre en OP-2026-021 nunca se programó, así que el efecto de esos cambios no se midió.

## Qué revisa

Toma los tiempos que el propio sistema guarda de cada operación (registro `RENDIMIENTO`) y, si tiene permiso, el estado interno de la base de datos:

1. Cuánto se usó el sistema: llamadas, operadores, horas pico.
2. Las 15 operaciones más usadas: cuánto tardan y en qué se va el tiempo (internet del usuario, verificación de cuenta y PIN, base de datos).
3. Las consultas que la app hace directo a la base.
4. Lo más lento, marcando lo que empeoró más de un 15 %.
5. Tiempos por operador (para detectar una mala conexión o un equipo lento) y por hora del día.
6. Errores y tiempos de espera agotados.
7. La base por dentro: consultas más lentas, tablas más grandes, tablas que necesitan limpieza y avisos de rendimiento de Supabase.
8. Si hay pocas muestras, lo dice y no saca conclusiones.

## Dónde quedan los resultados

- Un informe por semana en [`docs/operaciones/velocidad-semanal/`](velocidad-semanal/) con el nombre `AAAA-MM-DD_velocidad.md`.
- Un índice `velocidad-semanal/README.md` con una línea por semana (fecha, semáforo y tiempos clave). Así se ve la tendencia de un vistazo.
- Un aviso en esta app al terminar cada ejecución.

## Cómo funciona (en palabras simples)

Es como una alarma semanal: a la hora fijada, la app abre una sesión que lee los tiempos, los compara y escribe el informe. **La app de Claude tiene que estar abierta.** Si está cerrada a esa hora, la revisión corre cuando la abras.

La tarea quedó guardada en modo "Auto": trabaja sin pedir permiso para cada paso, pero sus instrucciones solo le dejan leer y escribir el informe. No puede cambiar código, publicar ni tocar la base de datos. Puedes cambiar el modo o pausar la tarea en la barra lateral, en **Programadas**.

## Primera ejecución (16-nov-2026)

- Resultado: 🟢 **unos 30 % más rápido** que la semana anterior y **0 errores**. Informe: [2026-11-16_velocidad.md](velocidad-semanal/2026-11-16_velocidad.md).
- Confirmó que los cambios de OP-2026-021 funcionaron: cada acción en el servidor tarda entre 0,1 y 0,6 s menos.
- Recomienda acelerar la lista de cotizaciones de los vendedores: tarda ~1 s en la base, cuando la lista sin filtro tarda 0,3 s. Falta un índice combinado (vendedor + fecha). Está **pendiente de aprobación**.
- Encontró, aparte de la velocidad, 138 notificaciones push fallidas en la semana. Parece un teléfono con una suscripción vencida que no se retira. Está **pendiente de revisar**.

## Pendiente / no verificado

- Los **avisos de rendimiento de Supabase** no se pudieron leer porque la conexión no tiene permiso. Se pueden ver en el panel de Supabase → Advisors → Performance.
- La **carga inicial de la app y el cambio de pantallas** todavía no se miden.
- El **crecimiento de las tablas** se podrá calcular desde el segundo informe.
- Los informes se escriben en el repositorio pero **no se guardan en git solos**: hay que incluirlos en un cambio posterior.

## Apartado técnico

- Tarea: `informe-semanal-velocidad` (`C:\Users\luigg\.claude\scheduled-tasks\informe-semanal-velocidad\SKILL.md`), programación `0 9 * * 1` en hora local, con un retraso automático de unos minutos.
- Consultas: archivos `.sql` de solo lectura en `tmp/port-tools/`, ejecutados con `tmp/port-tools/q-prod-full.mjs` (proyecto de producción `oyfyuszgjwcepjpngclv`).
- Reemplaza a las tareas de una sola vez `leer-mediciones-rendimiento` (4-nov) y `leer-mediciones-rendimiento-desglose` (10-nov), que ya se ejecutaron y están apagadas.
