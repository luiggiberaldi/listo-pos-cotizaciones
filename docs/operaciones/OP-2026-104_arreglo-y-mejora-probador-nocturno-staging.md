# OP-2026-104 — Arreglo y mejora del Probador nocturno en staging (1:00 a. m. VE)

**Fecha:** 2026-11-27  
**Rama:** `fix/op-104-probador-nocturno-staging`  
**Entorno:** GitHub Actions (solo staging `spupqgkdsgohxxfoxydl`; producción sin cambios).

---

## En resumen

- **Qué estaba fallando:** el Probador nocturno de la 1:00 a. m. (`staging-e2e-nightly.yml`) llevaba 5 madrugadas en rojo por un **falso positivo**: las 75 pruebas de ventas/despachos/devoluciones pasaban bien, pero al final el monitor del Kardex de almacén revisaba **todas las cuentas viejas** de la base de pruebas (con >3.400 apuntes históricos de copias anteriores) en lugar de revisar solo la cuenta E2E donde acababa de correr el robot.
- **Cómo se arregló:** se acotó `audit-kardex-staging.mjs` para que en modo automático audite únicamente la cuenta del robot E2E (`staging-e2e@listo.sys`), eliminando las falsas alarmas sin perder vigilancia real sobre cualquier error nuevo.
- **Mejora como refuerzo:** se agregó al mismo flujo nocturno la **batería completa de pruebas automáticas y de PDFs (`npm test`)** del proyecto principal y un **resumen claro en español** en GitHub.

---

## Cambios aplicados

1. [audit-kardex-staging.mjs](../../construacero-staging/scripts/audit-kardex-staging.mjs) — al correr con `service_role`, filtra por defecto a la cuenta E2E (`staging-e2e@listo.sys`) salvo que se pida explícitamente `STAGING_AUDIT_ALL_TENANTS=true`.
2. [staging-e2e-nightly.yml](../../.github/workflows/staging-e2e-nightly.yml) — suma la corrida completa de pruebas automáticas y PDFs (`npm test`) como refuerzo nocturno y mejora el resumen en español.
