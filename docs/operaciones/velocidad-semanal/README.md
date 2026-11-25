# Informes semanales de velocidad

## En resumen

Cada lunes a las 9 a. m. una tarea automática revisa **qué tan rápido respondió el sistema la semana anterior** y deja aquí un informe en lenguaje claro. Solo lee datos: no cambia nada del sistema. Cada informe trae un semáforo (🟢 más rápido · 🟡 igual · 🔴 más lento) y **una** recomendación, que siempre necesita la aprobación del dueño.

Caso que creó esta tarea: [OP-2026-029](../OP-2026-029_informe-semanal-velocidad.md).

Las dos cifras de referencia son el tiempo típico (lo que tarda la mitad de las veces) de las dos llamadas más usadas: **ver clientes** (`GET /api/clientes`) y **cargar la configuración** (`GET /api/config`). Línea base antes de las mejoras (2–7 nov 2026): 1.802 ms y 1.209 ms.

| Fecha (lunes) | Semáforo | Ver clientes (típico) | Configuración (típico) | Informe |
|---|---|---|---|---|
| 2026-11-16 | 🟢 | 1.201 ms (antes 1.744) | 820 ms (antes 1.151) | [2026-11-16_velocidad.md](2026-11-16_velocidad.md) |
