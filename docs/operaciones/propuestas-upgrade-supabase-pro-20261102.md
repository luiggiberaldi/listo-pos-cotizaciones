# Propuestas para aprovechar Supabase Pro (upgrade previsto el viernes 2026-11-06)

**Fecha:** 2026-11-02 · **Estado:** propuestas, para revisar con el dueño el viernes. Nada de esto está aplicado.

## En resumen

El sistema corre hoy en el plan gratis de Supabase. La base de producción pesa **53 MB** (de 500 MB), así que el espacio no es el problema. El valor de Pro está en **seguridad (respaldos), disponibilidad (sin pausa) y margen para crecer**. Los precios y límites cambian: confirmarlos en supabase.com/pricing antes de decidir.

## Qué cambia con Pro (en simple)

- Respaldos automáticos diarios (en el plan gratis no hay).
- El proyecto no se pausa por inactividad.
- Más capacidad de base de datos, consumo de datos y almacenamiento.
- Opcionales de pago: respaldo "al minuto" (PITR) y un servidor más potente.

## Datos de producción medidos el 2026-11-02 (solo lectura)

Base de 53 MB · PostgreSQL 17.6 · máximo 60 conexiones · tablas más grandes: `auditoria` 10,3 MB, `inventario_movimientos` 3,6 MB, `inventario_operaciones` 3,1 MB, `notas_despacho` 2,8 MB, `cotizacion_items` 2,5 MB. Extensiones: `pg_stat_statements`, `pgcrypto` (no hay `pg_cron`).

## Propuestas

| # | Propuesta | Para qué | Costo / riesgo | Recomendación |
|---|---|---|---|---|
| 1 | **Probar una restauración de respaldo** el primer día y documentarla | Un respaldo no probado no es garantía | Sin riesgo (se prueba en un proyecto aparte) | **Hacer el viernes** |
| 2 | **Respaldo al minuto (PITR)** | Volver la base a cualquier minuto de los últimos días (p. ej. tras un cambio masivo mal hecho) | Costo extra mensual | Decidir según cuánto duele perder unas horas de datos |
| 3 | **Servidor un poco mayor** | Pantallas lentas más rápidas, solo si hay falta de capacidad | Se sube y se baja | **Decidir con la medición de tiempos** (ver plan de optimización) |
| 4 | **Revisión de seguridad con el asesor de Supabase** y protecciones de acceso adicionales | Detectar tablas o permisos expuestos | Bajo | **Hacer** |
| 5 | **Alertas de uso y errores** (espacio, conexiones, picos) conectadas al webhook de alertas del repositorio | Enterarse antes de que algo se llene o falle | Bajo | **Hacer** |
| 6 | **Tareas automáticas nocturnas** para limpiar/archivar `auditoria` y similares | Base liviana con los años | Medio: definir qué se conserva y por cuánto tiempo | Después de medir |
| 7 | **Staging** | Probar migraciones sin tocar producción | Un segundo proyecto de pago es costo extra | Dejar staging en plan gratis |

## Orden sugerido

1. Viernes: subir a Pro → propuesta 1 (restauración de prueba) → 4 (asesor de seguridad) → 5 (alertas).
2. Esa semana: leer la medición de tiempos (tarea programada para el 2026-11-04) → decidir 3.
3. Decidir 2 y 6 con el dueño.

Relacionado: `docs/operaciones/plan-optimizacion-20261102.md`.
