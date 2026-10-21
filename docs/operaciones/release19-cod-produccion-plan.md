# Plan de subida a producción — Release 19 (cobro COD en pedidos de pago mixto)

**Preparado:** 20 de octubre de 2026 · **Ajustado:** 21 de octubre de 2026 · **Estado:** ✅ ejecutado el 21 de octubre de 2026 ([evidencia del cutover](release19-produccion-cutover-2026-10-21-10-22-15.md))
**Plan de pruebas:** [release19-cod-staging-20261020.md](release19-cod-staging-20261020.md)

---

## En resumen

- El fix del "cobro a destino" (COD) con varios métodos de pago ya está **preparado y
  probado** en la copia de pruebas (staging). Este documento deja todo listo para subirlo a
  **producción** (los clientes reales).
- **¿Es buena idea?** Sí prepararlo con tiempo. Subirlo conviene hacerlo en una **ventana
  tranquila** (poca gente usando el sistema) y conmigo ejecutándolo paso a paso. No hay
  ninguna prisa desde el punto de vista del negocio: lo que resuelve ya está funcionando
  mal hoy (los pedidos mixtos no se pueden cobrar bien), así que cuanto antes se suba,
  antes se arregla — pero con cabeza.
- **Lo que tú tienes que hacer:** solo decidir el momento y darme el "vamos". Todo el
  procedimiento está automatizado con protecciones; si algo no cuadra, se detiene solo
  **antes** de tocar nada.
- **Si algo sale mal:** hay plan B probado (volver atrás) en minutos. Los datos de los
  clientes no se pierden nunca: este cambio solo reemplaza dos funciones de cálculo.

---

## ¿Qué sube a producción?

Solo **dos funciones del sistema** (las que calculan el resumen financiero de un despacho y
registran el cobro COD). Es como cambiar el motor de cálculo de una calculadora: los
números ya escritos (ventas, cobros, comisiones) **no cambian**; solo cambia cómo se
calculan los cobros COD de aquí en adelante.

Lo que **no** se toca: inventario, cotizaciones, clientes, comisiones ya pagadas, ni la
aplicación web (esa se despliega aparte, por su canal habitual).

**Ajuste de contrato incluido (21 de octubre de 2026):** el campo de "evidencia del pago"
del formulario ahora se llama **Nota** y **no es obligatoria**. Si se deja vacía, el asiento
queda como "nota: (sin nota)"; admite hasta 500 caracteres. Además, la **referencia** de
los medios que no son efectivo (Zelle, transferencia/pago móvil, punto de venta, USDT)
queda en **mínimo 4 caracteres** (antes 2). Todo está ya dentro de las dos funciones que
suben, con sus pruebas actualizadas.

---

## Protecciones incluidas (por qué es seguro)

1. **Huella digital de los archivos** (SHA-256): el instalador comprueba que los archivos
   son **exactamente** los probados en staging. Si alguien los tocó sin querer, se detiene.
2. **Guarda de destino**: el instalador solo habla con el proyecto de **producción**
   (`oyfyuszgjwcepjpngclv`). Si por error apuntara a otro sitio, se detiene.
3. **Confirmación explícita**: no hace nada a menos que se ejecute con una frase de
   confirmación especial.
4. **Revisión del estado actual antes de tocar nada**: si el sistema no está exactamente en
   el estado esperado, se detiene y avisa (no "adivina").
5. **Todo en una transacción**: o se aplica completo y bien, o no se aplica nada.
6. **Respaldo automático**: antes de tocar las dos funciones, guarda copia exacta de cómo
   estaban, con su huella digital.
7. **Verificación después**: hoja de chequeo de 11 comprobaciones + prueba con datos reales
   (solo lectura).

---

## Paso a paso (cuando digas "vamos")

1. **Momento:** elige una ventana de baja actividad (por ejemplo, temprano en la mañana o
   al cierre). El proceso dura ~5 minutos y no bloquea el uso del sistema más de unos
   segundos.
2. **Verificación previa local:** yo corro el instalador en modo "solo lectura"
   (`--dry-run-parse`) para confirmar huellas y protecciones.
3. **Ejecución:**
   ```bash
   PRODUCCION_RELEASE19_CONFIRM=APLICAR_RELEASE19_PRODUCCION node scripts/apply-release19-produccion.mjs
   ```
   El instalador hace: revisión de estado → respaldo de las funciones actuales →
   instalación → hoja de chequeo 11/11 → prueba de lectura con dos despachos reales.
4. **Evidencia:** queda un informe automático en `docs/operaciones/release19-produccion-cutover-<fecha>.md`
   con cada paso y su resultado.
5. **Prueba visual rápida** (recomendada, 2 minutos): abrir la aplicación y comprobar que un
   despacho COD cualquiera muestra bien su resumen financiero.
6. **Cierre documental:** actualizo `BITACORA.md`, `CHANGELOG.md` y `matriz-migraciones.md`
   (la checklist de la casa lo pide; es trámite, no riesgo).

---

## Plan B — si algo sale mal (volver atrás)

El plan B está preparado y revisado: `supabase/release/main/19_cod_rollback_review.sql`
restaura **exactamente** las funciones anteriores (las mismas que hoy tiene producción).
Los cobros registrados mientras tanto **no se borran** (son historia contable válida) y el
sistema vuelve a comportarse como hoy.

Además, el instalador dejó **respaldo físico** de los cuerpos instalados (release 19) en
`supabase/release/main/19_backup_cuerpos/*.post19.live.sql` con su huella digital.
**Nota honesta de la ejecución del 21-oct:** el paso de pre-imágenes no capturó los cuerpos
previos (bug de comparación de firmas en el instalador, ya corregido); los cuerpos release 14
los conserva intactos el propio `19_cod_rollback_review.sql`, que es el artefacto que usa el
plan B, así que la reversión sigue plenamente disponible.

Tiempo estimado de vuelta atrás: ~2 minutos.

---

## Condiciones de NO-GO (cuándo NO subir)

- Que el instalador en modo lectura marque cualquier FAIL.
- Que haya cobros COD en curso en ese momento (esperar a que terminen).
- Que yo reporte cualquier error durante la revisión de estado: se detiene, se diagnostica
  y se decide, sin apurar.

---

## Apéndice técnico (para quien lo necesite)

- **Instalador:** [scripts/apply-release19-produccion.mjs](../../scripts/apply-release19-produccion.mjs)
  (patrón idéntico a `scripts/apply-release17-staging.mjs`; canal Management API HTTPS;
  credenciales `SUPABASE_ACCESS_TOKEN_PRODUCCION`/`SUPABASE_ACCESS_TOKEN` en `.env`, nunca
  impresas).
- **Artefactos y huellas:** `supabase/release/main/` —
  [19_cod_mixto_SHA256SUMS.txt](../../supabase/release/main/19_cod_mixto_SHA256SUMS.txt)
  (`sha256sum -c` → 6/6 OK verificado el 2026-10-21). El payload instalado en staging fue
  byte-idéntico (md5 `6701b6db…` baseline 14 / `117eda76…` paquete 19, ensamblado por
  trozos con separador `\n`) hasta el 2026-10-20; el 2026-10-21 el apply se actualizó
  (nota opcional + referencia mínima 4), se re-aplicó en staging verificado por marcadores
  y por la prueba funcional en navegador ([detalle](release19-cod-staging-20261020.md)).
- **Orden obligatorio:** preflight read-only → pre-imágenes (SHA-256 en
  `19_backup_cuerpos/*.live.sql`) → apply → postflight → smoke read-only → evidencia.
- **Estados previos que el instalador acepta:** (a) contrato release 14 exacto → aplica el
  19; (b) release 19 ya instalado (postflight 11/11) → sale 0 sin mutar; (c) funciones COD
  ausentes con precondiciones completas → baseline `14_cod_financial_rpcs_apply.sql` y luego
  el 19. Cualquier otro estado aborta sin mutaciones.
- **Guardas internas del SQL:** `19_cod_mixto_apply.sql` aborta por sí solo si el contrato
  vivo no es exactamente release 14 (`PRECONDICION_CONTRATO_NO_COINCIDE`) y está envuelto
  en `BEGIN…COMMIT`; el baseline 14 valida tablas/columnas/idempotencia
  (`PRECONDICION_*`) antes de crear nada.
- **Rollback:** `19_cod_rollback_review.sql` (gate `REVIEW_ONLY` deliberado: requiere
  decisión humana explícita de rollback) restaura los cuerpos byte-idénticos del release 14,
  sus COMMENTs y grants; no borra asientos, marcas de cobro ni registros de idempotencia.
- **Smoke del instalador:** `resumen_financiero_despacho` sobre hasta 2 despachos reales
  recientes con libro CxC (solo lectura); la verificación funcional completa (flujo mixto,
  guardas, idempotencia, comisiones) ya se hizo en staging con datos de prueba y está
  documentada en el informe de pruebas.
