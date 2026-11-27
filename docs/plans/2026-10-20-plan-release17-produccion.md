# Plan — Pasar a PRODUCCIÓN el "descuento de inventario al aprobar" (release 17)

**Fecha:** 2026-10-20 · **Estado:** PROPUESTO (esperando tu OK para ejecutar)
**Plan original:** [2026-10-19-plan-egreso-inventario-al-aprobar-despacho.md](2026-10-19-plan-egreso-inventario-al-aprobar-despacho.md)
**Evidencia de la prueba en staging:** [release17-cutover-staging-20261019.md](../operaciones/release17-cutover-staging-20261019.md)

---

## En resumen

Este plan activa en el sistema **real** (donde están tus clientes) el cambio de que el
inventario se descuente **al aprobar** el despacho, en vez de al entregar.

- **Incluye también el fix del reporte de ventas (fix 259):** en la misma ventana se
  corrige el reporte de ventas (resta el "corte", separa por negocio y pone el asesor
  correcto). No toca inventario; solo arregla números del reporte.
- **Los despachos antiguos se dejan casi tal cual** (decisión tuya, analizada en la §2b):
  solo se "cuadran" los que estén **despachados sin entregar** en el momento de la
  ventana (6 el 2026-10-20; cambian cada día). Los ~1.790 ya entregados no necesitan nada.
- **Es una sola sesión de trabajo** (una "ventana"), de unas **2-3 horas**, en horario de
  poca actividad. En pruebas ya funcionó todo: esta ventana es repetir lo probado, con
  más seguridad todavía (respaldo verificado de por medio).
- **Riesgo principal:** si algo sale mal a mitad de camino, se restaura el respaldo y
  quedamos como estábamos. Nada se borra: los movimientos de inventario son como un
  libro de contabilidad, solo se anotan cosas nuevas.
- **Qué necesito de ti:** (1) aprobar el plan, (2) decidir si los despachos "en vuelo"
  (6 el 2026-10-20; entran nuevos cada día y el script los toma solitos)
  se cuadran automáticamente (recomiendo eso) o se entregan/anulan antes de la ventana,
  (3) decirme **qué usuario real** queda como autor de ese cuadre, y (4) elegir el horario.
- **Mientras se ejecuta:** no se aprueban ni se revierten despachos (aviso a tu equipo).

---

## 1. Qué se va a hacer (en orden)

| Paso | Qué pasa | Duración aprox. | ¿Riesgo? |
|---|---|---|---|
| 0. Preparación | Verificar que todo está listo (checklist abajo) | 15 min | ninguno |
| 1. **Respaldo verificado** | Copia de seguridad de productos, movimientos de inventario y despachos + **prueba de restauración** en una copia | 30-45 min | ninguno (solo lectura + copia) |
| 2. Aplicar el cambio en la base | La "receta" del release 17 se aplica en la base real, con verificación de integridad paso a paso | 10-15 min | medio — ventana crítica |
| 2b. Aplicar el fix del reporte (259) | La receta `240_fix_reporte_ventas_corte_y_cuenta.sql` corrige el reporte de ventas. Solo toca 2 funciones de reporte — **cero inventario** | 5-10 min | bajo |
| 3. Cuadrar los "en vuelo" | Solo los despachos **despachados sin entregar** que haya en ese momento (6 el 2026-10-20; cambian cada día) reciben su descuento retroactivo. Las entregadas antiguas se quedan tal cual (§2b) | 5-10 min | medio — ventana crítica |
| 4. Actualizar la aplicación | Se publica la nueva versión del Worker + la web **juntos** (`./deploy.sh`) | 10-20 min | medio — ventana crítica |
| 5. **Prueba de humo** | Comprobar cada movimiento con un producto de prueba: aprobar descuenta, entregar no descuenta dos veces, devolver reingresa, etc. | 30-45 min | ninguno (solo prueba) |
| 6. Guardar oficialmente | Confirmar ("commit") los cambios del código que hoy están sin firmar | 5 min | ninguno |
| 7. Limpieza posterior *(otro día)* | Borrar 4 recetas viejas que ya no se usan | 15 min | bajo |

**Regla de oro:** los pasos 2, 2b, 3 y 4 van **en la misma sesión, sin pausas largas entre ellos**.
Si la base queda nueva y la aplicación vieja, se contradicen (como cambiar el manual de
instrucciones sin cambiar la máquina). El paso 1 (respaldo) sí puede hacerse horas antes.

**Duración total de la ventana:** 2-3 horas, incluyendo la prueba de humo.

---

## 2. Decisiones previas (antes del paso 3)

**Decisión A — ¿cómo se cuadran los despachos "en vuelo"?** (despachados sin entregar;
el 2026-10-20 al atardecer había 6 en producción: #1930, #1933, #2144, #4019, #4098 y
#4099 — entran nuevos cada día, el script del paso 3 los toma solitos):

- **Recomendado: cuadre automático.** El paso 3 les aplica su descuento retroactivo
  (script que puede repetirse sin doble efecto; solo toca esos). No depende de que
  ventas logre entregarlos antes.
- Alternativa: entregarlos o anularlos **antes** de la ventana con la aplicación actual
  (que sí sabe descontar al entregar). Solo sirve si la lista queda vacía el día de la
  ventana — cuidado: pueden entrar nuevos "en vuelo" entre hoy y esa fecha.

**Decisión B — el usuario autor del cuadre** (a nombre de quién queda registrado):

- **Recomendado:** tu usuario de supervisión real (quien responde ante el negocio).
- Alternativa: un usuario técnico dedicado (más limpio para auditoría, pero hay que crearlo).

> ⚠️ **Confirmar ambas antes del paso 3.** Sin ellas no se ejecuta el cuadre.

## 2b. ¿Dejar los despachos antiguos sin reparar? — análisis (tu pregunta)

**Respuesta corta: sí se puede, con una sola excepción.** Conteos verificados en
producción el 2026-10-20 y qué pasa si no se les hace nada:

| Estado | En producción | ¿Problema si se deja así? |
|---|---|---|
| entregada (ya entregada) | ~1.790 (crece cada día) | **Ninguno.** Su descuento ya ocurrió al entregar (modelo viejo); todo cuadra. |
| anulada | 365 | **Ninguno.** Ya cerradas; nada volverá a tocarlas. |
| pendiente | 96 | **Ninguno.** Se comportan como "nuevas": al aprobarlas ya descuentan al aprobar. |
| **despachada (en vuelo)** | **6** | **SÍ hay problema.** Fueron aprobadas con el modelo viejo (todavía sin descontar). Con el código nuevo: si se entregan **nunca** se descontaría (el nuevo asume que ya se descontó al aprobar) y si se devuelven o anulan se **sumaría** stock que nunca salió. En ambos casos el inventario quedaría inflado. |

Por eso el paso 3 solo cuadra los "en vuelo" (6 el 2026-10-20; los que haya el día de
la ventana) y deja el resto tranquilo.

> 📌 Dato real encontrado el 2026-10-20: no todos los "en vuelo" son iguales. El #2144
> ya había sido entregado el 3/ago y revertido a pendiente el 4/ago (con reingreso de
> stock), y luego re-aprobado: su historial deja **neto cero**, así que sí debe cuadrarse.
> El script del paso 3 calcula ese neto caso por caso y solo salta a los que ya dejaron
> unidades fuera (evitando dobles descuentos).

**Lo único que se pierde al no "sellar" las ~1.790 entregadas:** la etiqueta de
trazabilidad que las vincula con su movimiento del libro de inventario. Afecta solo a
informes de auditoría históricos (qué lote salió con cada entrega antigua); **cero
impacto en dinero, stock, comisiones o ventas.** Las devoluciones sobre entregas
antiguas siguen funcionando igual.

---

## 3. Ventana de silencio (mientras dura la sesión)

Entre el paso 2 y el paso 4:

- **Nadie aprueba ni revierte despachos en producción.** La aplicación vieja no sabe
  reingresar inventario al devolver un despacho y rompería la cuadratura.
- Avisar a operación/ventas: "sistema de despachos en mantenimiento breve, ~2 horas".
- El resto del sistema (cotizaciones, clientes, caja) **sigue funcionando**; solo el
  módulo de despachos queda en pausa.

---

## 4. Checklist previo (paso 0)

- [ ] Confirmadas las decisiones A y B (sección 2).
- [ ] Horario elegido (recomendado: después del cierre del día o fin de semana).
- [ ] Equipo avisado de la ventana de silencio.
- [ ] Los 6 respaldos de funciones previas existen y son correctos:
      `supabase/release/main/17_backup_cuerpos/*.live.sql` (verificados byte a byte contra
      la base de staging; en producción se vuelven a verificar contra la base real ANTES
      de tocar nada).
- [ ] Los 4 artefactos del release listos en `supabase/release/main/`:
      `17_egreso_inventario_aprobacion_apply.sql`, `17_egreso_inventario_backfill.sql`,
      `17_egreso_inventario_postflight_readonly.sql`, `17_egreso_inventario_rollback_review.sql`.
- [ ] `./deploy.sh` funciona en local (build verde: `npx vitest run` + `npx vite build`).
- [ ] Token de acceso a producción disponible (el del `.env`, ya verificado el 2026-10-20).
- [ ] Fix 259 (reporte de ventas) **incluido** en esta ventana: receta
      `supabase/migrations/240_fix_reporte_ventas_corte_y_cuenta.sql`, con sus
      pre-imágenes ya capturadas en `supabase/release/main/18_reporte_ventas_backup_cuerpos/`
      (byte-exactas contra producción, verificadas 2026-10-20).

---

## 5. Cómo se ejecuta cada paso (para quien lo ejecute)

### Paso 1 — Respaldo verificado (OBLIGATORIO antes de tocar nada)

1. Volcado de las tablas críticas: `productos`, `inventario_movimientos`,
   `notas_despacho`, `notas_despacho_items` (mismo criterio que el plan COD).
2. **Prueba de restauración:** restaurar el volcado en un entorno de copia y comprobar
   conteos idénticos. Un respaldo sin restaura probada no cuenta como respaldo.
3. Verificar contra producción los 6 cuerpos de funciones previos (md5 de
   `pg_get_functiondef()` vivo vs los `.live.sql` guardados). Si alguno difiere: **PARAR** —
   la pre-imagen no es válida y el rollback quedaría cojo.

### Paso 2 — Aplicar el cambio en la base

- Artefacto: `17_egreso_inventario_aprobacion_apply.sql` (sin `BEGIN/COMMIT`; se ejecuta
  atómico).
- Protocolo **md5-por-trozos** (el mismo probado en staging): el SQL viaja en trozos de
  ≤2.000 caracteres con md5 por trozo y md5 total comparado en el servidor ANTES de
  ejecutar, dentro de un `DO` con guardia: si el ensamblado no coincide byte a byte,
  aborta sin tocar nada.
- Verificación post-apply: 7 firmas de funciones vivas, 3 columnas nuevas en
  `notas_despacho` (`egreso_lote_id`, `alerta_stock`, `alerta_stock_items`), permisos
  solo `service_role` (igual que en staging).

### Paso 2b — Fix del reporte de ventas (fix 259)

- Artefacto: `supabase/migrations/240_fix_reporte_ventas_corte_y_cuenta.sql`
  (solo reemplaza 2 funciones de reporte: `obtener_reporte_ventas_operaciones` y
  `obtener_reporte_ventas_comisiones`).
- Pre-imágenes para deshacer: `supabase/release/main/18_reporte_ventas_backup_cuerpos/`
  (capturadas de producción el 2026-10-20, byte-exactas).
- Verificación: los reportes siguen abriendo; si hay ventas con "corte", la venta neta
  ahora aparece **menor** (correcto: antes se sobredeclaraba); cada usuario solo ve
  ventas de su negocio; el asesor de cada venta es el del cliente.

### Paso 3 — Cuadrar los "en vuelo" (backfill mínimo)

- Artefacto: `supabase/release/main/17b_egreso_inventario_backfill_envuelo.sql` —
  variante ya lista y ensayada (2026-10-20) de `17_egreso_inventario_backfill.sql`.
  **En la ventana se ejecuta ESTE archivo, no el original.**
  - Solo procesa los `despachada` que haya **en el momento de ejecutar** (filtro
    dinámico). Las entregadas legadas quedan **totalmente intactas** (ni se sellan),
    como decidiste.
  - **Idempotente**: puede re-ejecutarse sin doble efecto.
  - **Guarda por neto histórico**: cada candidato se clasifica según la suma de
    egresos menos ingresos de su historial en el libro de inventario. Neto cero → se
    cuadra; neto positivo (p. ej. una entrega legada revertida a "en vuelo" tras el
    deploy) → se **salta con aviso**, para no descontar dos veces; neto negativo → el
    script se **niega a ejecutar** y lista el número para revisión manual.
  - Ensayado en un Postgres desechable (2026-10-20) con los cuatro escenarios:
    limpio ✓, neto cero (caso #2144) ✓, neto positivo saltado ✓, neto negativo
    aborta sin tocar nada ✓ — más la re-ejecución, que queda en cero.
- Ajuste obligatorio: fijar el usuario autor elegido en la sección 2 (decisión B).
- Verificación (postflight `17_egreso_inventario_postflight_readonly.sql` + la propia
  salida del script, que hay que conservar como evidencia):
  - **Invariante: ningún despacho `despachada` sin marca de egreso, salvo los que la
    salida liste como "SALTADO POR GUARDA"** (deben ser pocos o ninguno; cada uno
    aparece con su neto para revisión). Las entregadas antiguas sin marca aparecerán
    en la tabla del informe y **eso es esperado** en esta variante (ver §2b) — no es
    un fallo.
  - Evidencia por despacho (lote, movimientos, unidades) — conservar la salida como
    evidencia del cutover.

### Paso 4 — Actualizar la aplicación

- `./deploy.sh` publica **Worker y frontend juntos** (build + deploy con los secrets de
  `.env.secrets`). Nunca uno sin el otro.

### Paso 5 — Prueba de humo (con producto de prueba, en producción)

Por cada transición (checklist del plan original §5.4):

- [ ] Aprobar despacho → el stock **baja** y aparece el movimiento `egreso` en kardex.
- [ ] Entregar → **no** vuelve a descontar ni crea movimiento.
- [ ] Revertir entrega (de vuelta a "despachada") → **no** reingresa nada.
- [ ] Devolver a pendiente / anular desde "despachada" → **reingresa** + movimiento.
- [ ] Editar un despacho pendiente → stock intacto.
- [ ] Venta rápida → descuenta al aprobar.
- [ ] Devolución post-entrega → reingresa solo lo devuelto.
- [ ] El chip "N comprometidas" ya **no existe** en inventario, venta rápida ni cotizaciones.
- [ ] Dos aprobaciones simultáneas del mismo producto no duplican ni pierden descuentos.
- [ ] **Reporte de ventas (fix 259):** abrir el reporte del mes en curso; si hay ventas
      con "corte", la venta neta sale **menor** que antes (correcto); el asesor de cada
      venta es el del cliente; un usuario de un negocio solo ve ventas de su negocio.

### Paso 6 — Guardar oficialmente

- Confirmar (commit) los cambios T7/T8/T9 que hoy viven sin firmar en el working tree.
  Mensaje sugerido: "release 17: egreso de inventario al aprobar (fin del stock comprometido)".

### Paso 7 — Limpieza posterior (otro día, coordinado)

- DROP de las 4 RPCs obsoletas (`obtener_stock_comprometido`, `_detalle`,
  `crear_nota_despacho`, `anular_despacho_atomico`) — plan original §4.3.

---

## 6. Si algo sale mal (rollback)

Revisar siempre primero `17_egreso_inventario_rollback_review.sql` (guardas del rollback).

| Situación | Qué hacer |
|---|---|
| Falla ANTES del paso 4 (sin tráfico nuevo) | Restaurar los 6 cuerpos previos (`.live.sql` o stash `release_17_backup_cuerpos` en la base) + deshacer la reparación del pasado (reingreso espejo por los lotes `md5('migra-egreso-17-'||id)`; los movimientos de migración se identifican por su motivo "MIGRACIÓN — egreso por cambio de modelo"). Las 997 entregadas viejas solo llevan marca: basta limpiarla. |
| Falla DESPUÉS del paso 4 (con tráfico nuevo) | **No** revertir solo la base. Coordinar en la misma ventana: versión anterior de la app + cuerpos previos. Si ya hubo egresos reales, escalar a reconciliación de inventario. |
| Problema solo de pantalla (los números están bien) | Mantener la base nueva y volver solo la parte visual de la app. |
| Problema solo en el reporte de ventas (fix 259) | Restaurar los 2 cuerpos guardados en `supabase/release/main/18_reporte_ventas_backup_cuerpos/`. Es independiente del cambio de inventario: puede deshacerse solo. |
| Catástrofe mayor | Restaurar el respaldo verificado del paso 1 (por eso se prueba la restauración antes). |

**Nada se borra nunca:** los movimientos de inventario son evidencia; el rollback añade
movimientos de reingreso, no borra historial.

---

## 7. Riesgos conocidos (y por qué no asustan)

- **Series históricas de kardex:** los descuentos pasan a fecharse al aprobar en vez de al
  entregar. Contablemente es más correcto, pero los informes por fechas cambian de
  momento. *(Decisión consciente del plan.)*
- **Venta Anticipada y stock negativo:** se conservan tal cual (paridad confirmada).
- **Comisiones y cajas:** este cambio **no** las toca (fuera de alcance confirmado).
- **Ruta legacy de aprobación:** queda eliminada en el paso 4 (el paso 7 solo limpia
  recetas muertas) — no debería existir forma de descontar dos veces.

---

## 8. Qué NO incluye este plan

- "Sellar" las entregadas antiguas (~1.790): quedan sin etiqueta de trazabilidad a
  propósito (ver §2b). Si algún día se quiere, el script idempotente puede correrse
  después sin riesgo.
- Migraciones de staging 277-282 del checkout ERP.
- Préstamos de inventario (sin cambios).
