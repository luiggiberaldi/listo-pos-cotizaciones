# OP-2026-103 — Verificador diario automático de ventas en staging (12:00 a. m. L–S)

**Fecha:** 2026-11-27  
**Rama:** `feat/op-103-verificador-diario-staging`  
**Entorno:** GitHub Actions en la nube → lee producción en modo **100 % solo lectura** y replica/valida únicamente en **staging** (`spupqgkdsgohxxfoxydl`).

---

## En resumen

- Se creó un **flujo automático nocturno en GitHub** que corre solo todos los días a las **12:00 a. m. hora Venezuela** para revisar las ventas reales de **lunes a sábado** (omite domingos automáticamente), **aunque tu computadora esté apagada**.
- **Cero riesgo para producción:** el programa solo puede leer datos de producción (`SELECT` / `GET`) y tiene un candado que bloquea cualquier escritura fuera de la base de pruebas (`staging`).
- **Qué revisa cada noche:**
  1. Lee los despachos, devoluciones y movimientos de Crédito/CxC del día que acaba de cerrar en producción.
  2. Los replica en tu cuenta de pruebas `copia-prod@construacero.staging` en staging.
  3. Verifica al centavo los totales de ventas, cobrado, por cobrar, formas de pago y saldos CxC de los clientes del día.
  4. Genera un **PDF real de Ventas del día** para comprobar que sale limpio y sin errores.
  5. Guarda automáticamente un **reporte diario en español** en `docs/operaciones/reportes-diarios/AAAA-MM-DD.md` y lo muestra en el resumen de GitHub.
- **No requiere configurar claves nuevas:** reutiliza las mismas claves de GitHub que ya están funcionando en tus flujos nocturnos (`MAIN_SUPABASE_ACCESS_TOKEN`, `STAGING_SUPABASE_URL` y `STAGING_SUPABASE_SERVICE_KEY`).

---

## Horario programado

- **Expresión cron:** `0 4 * * 2,3,4,5,6,0` (04:00 UTC = **12:00 a. m. Venezuela** de martes a domingo).
- Cada corrida revisa **el día anterior** (lunes a sábado). El lunes a las 12:00 a. m. (cuando el día anterior fue domingo) no corre.
- También puede ejecutarse **manualmente en cualquier momento** desde la pestaña **Actions** de GitHub eligiendo cualquier fecha (`AAAA-MM-DD`).

---

## Archivos creados

- [verificador-diario-staging.mjs](../../scripts/verificador-diario-staging.mjs) — Programa verificador con candados de solo lectura en producción y validación de PDFs reales.
- [verificador-diario-staging.yml](../../.github/workflows/verificador-diario-staging.yml) — Flujo automático en GitHub Actions (12:00 a. m. L–S + ejecución manual).
- Carpeta de salida de reportes: `docs/operaciones/reportes-diarios/`.
