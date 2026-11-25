# Plan — Paso a producción: Release 17 (egreso al aprobar) + Lote ERP (reporte Crédito/CxC) · 2026-10-21

**En resumen:** este plan sube en UNA sola ventana dos cosas ya probadas y listas:
(1) el **Release 17** — el inventario se descuenta al aprobar el despacho, no al entregar — que
necesita tocar la base de datos, el Worker y la interfaz **en ese orden y dentro de la misma
ventana**; y (2) el **Lote ERP** — la pestaña Crédito/CxC de Reportes con su "Cuadre de
movimientos" — que ya quedó **arreglado y verificado por la interfaz** el 21-oct y que solo toca
la interfaz. Riesgo principal: dejar el sistema viejo funcionando contra la base nueva entre el
cambio de base y el despliegue de la aplicación; el plan lo evita con una ventana tranquila y
pasos encadenados. **Nada de esto se ejecuta todavía**: es el guion de la ventana.

---

## 0. Qué sube y qué NO

| Bloque | ¿Sube? | Piezas que viajan |
|---|---|---|
| **Release 17** (egreso de inventario al aprobar) | ✅ Sí | SQL de la base (`17_egreso_inventario_aprobacion_apply.sql` + backfill), Worker (`api/handlers/despachos.js`), interfaz (despachos + inventario) |
| **Arreglo del motivo de reapertura** | ✅ Sí (junto al Worker) | `api/handlers/despachos.js` — el motivo de "Reabrir despacho" ya se guarda |
| **Lote ERP** (reporte Crédito/CxC) | ✅ Sí (solo interfaz) | `src/hooks/useReportePeriodoCxC.js` (nuevo), `src/views/ReportesView.jsx`, `src/utils/cxcPeriodReport.js` + pruebas |
| Observación O1 (fecha de aprobación al reaprobar) | ❌ No | Se decide aparte: ¿mostrar la primera o la última aprobación? |
| Observación O2 (el modal acepta pago mayor que el total) | ❌ No | Trabajo aparte con su prueba |
| DROP de las 4 RPCs obsoletas | ❌ No | Paso posterior y coordinado (ver §6) |

## 1. GATES — todo esto debe estar en verde ANTES de abrir la ventana

- [ ] Pruebas completas del proyecto: **673/673** en verde (incluye las del Release 17, las del
      reporte Crédito/CxC y los contratos de reversión). *(Estado 21-oct: en verde; hubo UNA
      pasada con 1 fallo intermitente que no volvió a aparecer en 6 pasadas siguientes — si
      vuelve a fallar, identificarlo antes de abrir la ventana.)*
- [ ] Compilación (`npx vite build`) sin errores (el aviso de "chunks > 500 kB" es conocido y
      permitido).
- [ ] ESLint sin errores (avisos de estilo preexistentes, permitidos).
- [ ] Verificación por interfaz del reporte Crédito/CxC: **superada el 21-oct** con el smoke
      automático `scripts/test-cxc-reporte-ui.mjs` (18 comprobaciones, evidencia en
      `tmp/cxc-reporte-ui/`). Repetir ese smoke el día de la ventana.
- [ ] Commit del release preparado y revisado (los cambios viven SIN confirmar en el árbol:
      T7/T8/T9 del Release 17, motivo de reapertura y el Lote ERP). **No empujar** hasta el
      paso 4 de la ventana: producción (Vercel) se despliega sola al empujar a `main`.
- [x] Backup de **producción** verificable + restauración probada (§3): herramienta lista y
      probada el 21-oct (PASS con triple verificación + prueba negativa). En la ventana se vuelve
      a ejecutar fresco: `node scripts/backup-release17-produccion.mjs --verify`.

## 2. Entendiendo la ventana (para quien no es técnico)

Imaginen que el sistema es un almacén con un manual de instrucciones (la base de datos) y un
equipo de empleados (la aplicación) que lo siguen. Este release **cambia el manual**: "la
mercancía sale del inventario cuando se aprueba el despacho, no cuando se entrega". Si cambiamos
el manual pero el empleado sigue con el manual viejo en la mano, hará cosas raras (devoluciones
que no reingresan stock). Por eso:

- El cambio de base y el despliegue de la aplicación van **juntos, uno detrás del otro**.
- Entre ambos **no se aprueban ni se devuelven despachos** (unos minutos de espera).
- Todo tiene "plan B" (§5): si algo sale mal, se restaura el manual anterior y la aplicación
  anterior.

## 3. Preparación (el día anterior o la mañana de la ventana)

0. **LA VENTANA EN UN SOLO COMANDO (22-oct) — forma recomendada de ejecutar los pasos 2+3:**
   `node scripts/ventana-release17-produccion.mjs`
   Recorre la ventana paso a paso y **se DETIENE en el primero que falle** (nada posterior se
   ejecuta): (1) comprobaciones rápidas + preflight solo lectura contra producción, (2) respaldo
   fresco en carpeta nueva con restauración probada fila por fila (nunca pisa el respaldo de
   referencia), (3) instalación del release 17 — el único paso que escribe, y solo tras escribir
   **APLICAR** con el teclado — y (4) verificaciones: prueba en seco del plan B para dejar
   constancia de que la reversión está lista. Cierra con resumen y evidencia en
   `docs/operaciones/release17-ventana-<ts>.md`. **Probado el 22-oct:** prueba en seco completa
   (`--dry-run`, pasos 1-2) PASS con triple verificación (12/12 comprobaciones) y ensayo del
   mecanismo de parada con fallo simulado (se detiene y sale con código de error). NO hace los
   pasos 4-7 de la ventana (commit + empuje, smokes de la aplicación, aviso al equipo).
   Prueba en seco de la ventana: `node scripts/ventana-release17-produccion.mjs --dry-run`.

1. **Backup de producción con restauración probada — HERRAMIENTA LISTA Y PROBADA (21-oct):**
   un solo comando hace respaldo + prueba de restauración + re-verificación contra producción:
   `node scripts/backup-release17-produccion.mjs --verify`
   - Respalda las 4 tablas críticas (`productos`, `inventario_movimientos`, `notas_despacho`,
     `notas_despacho_items`) desde producción **por solo lectura**, con SHA-256 de archivos y
     huella de **contenido** por tabla (cada fila comparada, no solo el número de filas).
   - Restaura TODO en un PostgreSQL desechable local y compara por contenido; además vuelve a
     consultar producción viva y exige coincidencia triple (producción = manifiesto = restauración).
   - **Probado el 21-oct (noche): PASS** — 466 + 6.584 + 2.293 + 5.493 filas restauradas idénticas.
     Prueba negativa superada: una copia alterada (incluso con su huella parcheada) fue detectada.
   - Respaldo de referencia: `C:\Users\luigg\Desktop\construacero-backups\release17-2026-10-22\`
     (`esquema.sql` sha256 `cf648ef79a2c…`, `datos.sql` sha256 `f128309be23d…`, 14.836 filas).
     El día de la ventana se vuelve a ejecutar el mismo comando para un respaldo FRESH.
   - Alternativa completa (todo el esquema, no solo inventario): `scripts/backup-supabase-logical.mjs`
     + `scripts/verify-logical-backup.mjs` (experiencia previa del proyecto).
2. **Pre-imágenes de las funciones que se van a redefinir** (6 cuerpos vivos):
   `supabase/release/main/17_backup_cuerpos/*.live.sql` — el instalador los captura y compara
   con `md5(pg_get_functiondef())`. *Lección release 19: la captura de pre-imágenes falló por
   los nombres de parámetros de identidad; el instalador ya está corregido (búsqueda por
   `to_regprocedure`). Usar siempre la versión corregida de `scripts/`.*
3. **Instalador del Release 17 para producción: YA CREADO y probado en seco**
   (`scripts/apply-release17-produccion.mjs`). Tiene tres modos:
   - `node scripts/apply-release17-produccion.mjs --dry-run-parse` — prueba en seco sin red
     (huellas de los artefactos, firmas, árbol de decisión).
   - `node scripts/apply-release17-produccion.mjs` — **prueba en seco contra producción (solo
     lectura)**: repite todo el preflight de la ventana y termina con el veredicto
     LISTO / NO LISTO. **Ejecutada el 2026-10-21 → "LISTO PARA LA VENTANA"** (6 firmas vivas,
     función nueva y columnas ausentes = estado limpio, operador validado, 1.824 despachos
     cerrados por migrar, kardex actual 6.584 movimientos).
   - Con confirmación explícita + `--apply` → la ventana real (pre-imágenes → apply → backfill →
     postflight → smoke). Sin la confirmación se niega a mutar (probado).
   - La prueba en seco también imprime el **PLAN de inventario por despacho** (DESCUENTA /
     SALTADO) para revisarlo antes de abrir la ventana; ensayada el 21-oct tras la decisión de
     exclusión: `#4019 DESCUENTA 15`, `#4161 DESCUENTA 6.315`, `#1930/#1933/#2144 SALTADO`,
     1.819 entregadas solo se sellan → **LISTO PARA LA VENTANA**. El backfill con la lista de
     exclusión se ensayó además en un PostgreSQL desechable local
     (`scripts/test-release17-backfill-local.mjs` — 17 comprobaciones, incluida idempotencia).
   Guardias: destino fijado a `oyfyuszgjwcepjpngclv`, huellas SHA-256 de los artefactos
   (`17_egreso_inventario_SHA256SUMS.txt`), aborta ante cualquier estado previo que no sea el
   esperado, y busca las firmas por `to_regprocedure` (tolerante a nombres de parámetro, lección
   del cutover release 19). Las pre-imágenes de producción se guardan en
   `17_backup_cuerpos_produccion/` (separadas de las de staging).
4. **Operador del kardex de migración — DECISIÓN TOMADA (21-oct):** las anotaciones de la
   migración quedan firmadas con el nombre visible **"MIGRACIÓN release 17"** y la referencia
   interna a la cuenta técnica **Desarrollador** (`00000000-0000-0000-0000-000000000000`) — la
   misma cuenta usada en el ensayo de staging. El operador "luigi" de staging **no existe** en
   producción (verificado); si se prefiere otra cuenta, se cambia con `RELEASE17_OPERADOR_ID`.4b. **Despachos obsoletos — DECISIÓN TOMADA (21-oct):** **#1930, #1933 y #2144 no se tocan en absoluto** (quedaron fuera del sistema; su mercancía ya está en el conteo exacto). El backfill los saltea por completo y la verificación final los acepta como "sin lote" a propósito. **⚠️ Quedan congelados: no se deben devolver, anular ni editar desde el sistema** (una acción así sumaría unidades que nunca salieron). Si algún día hay que moverlos, avísame primero.
5. Revisar que **no haya operación de almacén en curso** al abrir la ventana (últimos despachos aprobados hace rato; nadie procesando pedidos).

## 4. La ventana — orden exacto (≈ 45–60 min)

**Regla de oro: entre el paso 2 y el paso 5, NO aprobar, revertir ni editar despachos.**

> **Atajo (22-oct):** los pasos 2+3 de esta tabla van encadenados y con parada en fallo en
> `node scripts/ventana-release17-produccion.mjs` (ver §3.0), que además ejecuta antes el
> respaldo verificado (preparación §3.1) y después la comprobación del plan B. Los pasos 1 y
> 4-8 siguen siendo humanos/manuales.

| Paso | Qué se hace | Cómo se comprueba que salió bien |
|---|---|---|
| 1 | Avisar al equipo: "ventana de mantenimiento, no procesar despachos" | Confirmación humana |
| 2+3 | **Apply + Backfill con UN comando** (el instalador hace pre-imágenes → apply → backfill → postflight → smoke):
  `PRODUCCION_RELEASE17_CONFIRM=APLICAR_RELEASE17_PRODUCCION RELEASE17_OPERADOR_ID=00000000-0000-0000-0000-000000000000 node scripts/apply-release17-produccion.mjs --apply`
  **Impacto en stock (decisión 21-oct, verificado en seco contra producción):** el backfill (a) sella con un lote de egreso las entregadas viejas (1.819 al 21-oct) **sin tocar su stock** — ya descontaron al entregarse — y (b) aplica el descuento retroactivo SOLO a los "en vuelo" que NO estén excluidos: al 21-oct **solo #4019 (15 uds) y #4161 (6.315 uds) descuentan = 6.330 unidades**. Los obsoletos **#1930, #1933 y #2144 se saltean por completo** (ni egreso, ni sello, ni movimiento): su mercancía (71 uds) queda en el conteo exacto. Despachos "en vuelo" nuevos que haya el día de la ventana sí descuentan normalmente (filtro dinámico). El total del catálogo baja solo por 6.330 unidades (261.941 → ~255.611); el **disponible** (lo vendible) NO cambia, porque esas unidades ya hoy aparecen como "comprometidas". El kardex de migración firmado "MIGRACIÓN release 17" se escribe solo para los despachos realmente descontados. Es **idempotente**: el propio comando lo re-ejecuta para probarlo, sin doble efecto | Postflight: **0 despachados/entregados sin lote salvo los 3 obsoletos decididos**, sin lotes duplicados, permisos solo `service_role`, columnas nuevas presentes, kardex de migración con unidades cuadradas. Evidencia automática en `docs/operaciones/release17-produccion-cutover-<fecha>.md` |
| 4 | **Commit + empuje** del release completo (Release 17 + motivo de reapertura + Lote ERP) a `main` | Vercel despliega el frontend solo; el job `deploy-worker.yml` despliega el Worker — ambos en verde |
| 5 | **Verificar la aplicación nueva ya activa**: versión del Worker (`npx wrangler deployments list`), `vercel.app` respondiendo 200, `/api/ping` 200 | Sin errores nuevos en los logs del Worker |
| 6 | **Smoke semántico en producción** con producto de prueba (crear, aprobar, verificar egreso, revertir y verificar reingreso; el motivo de reapertura se guarda). Se puede reutilizar el patrón de `scripts/test-cxc-reporte-ui.mjs` (crea sus datos y los limpia), con la guardia de entorno apuntando a producción solo para este paso manual | Kardex cuadra; inventario vuelve exacto al revertir |
| 7 | **Smoke del reporte Crédito/CxC** en la app real: rangos de fecha, KPIs con cifras reales, "Cuadre de movimientos" cuadrado, pestaña Movimientos con filas, PDFs | "Saldo actual coincide" (o la diferencia explicada) |
| 8 | Avisar al equipo: "ventana cerrada, pueden trabajar" | Confirmación humana |

## 5. Si algo sale mal (plan B)

1. **El SQL de la base — EMPAQUETADO EN UN SOLO COMANDO (22-oct) y probado en seco:**
   - Prueba en seco (solo lectura, en cualquier momento):
     `node scripts/rollback-release17-produccion.mjs` → dice qué se revertiría (despachos,
     unidades, sellos, cuerpos a restaurar) y termina con LISTO / NO APLICA.
   - Reversión real (requiere confirmación explícita):
     `PRODUCCION_RELEASE17_ROLLBACK_CONFIRM=REVERTIR_RELEASE17_PRODUCCION node scripts/rollback-release17-produccion.mjs --apply`
     → reingreso espejo de los lotes de migración (6.330 unidades vuelven a su sitio), limpieza
     de sellos, restauración de los 6 cuerpos previos desde las pre-imágenes del instalador
     (`17_backup_cuerpos_produccion/*.live.sql`), eliminación de la función nueva, y verificación
     completa del retorno. **El kardex nunca se borra**: la inversión se registra como
     "ROLLBACK release 17" (con operador real, defecto hallado y corregido en el ensayo).
   - **Ensayo general PASS (22-oct):** respaldo → instalación → reversión con el comando real →
     retorno EXACTO al punto de partida (stocks idénticos, kardex antiguo intacto, obsoletos sin
     tocar). Ensayo: `scripts/test-release17-rollback-local.mjs`.
   - Recordatorio del propio comando: **revertir también la APLICACIÓN** (revert del commit de
     app) en la misma ventana.
2. **La aplicación:** deshacer el empuje (revert del commit) y dejar que Vercel y GitHub Actions
   desplieguen la versión anterior — o re-desplegar el commit anterior. El Worker nuevo y el
   viejo saben convivir con las funciones nuevas, pero **no** al revés: si se revierte la base,
   se revierte también la aplicación.
3. **Comunicación:** si el plan B se activa, se reporta en `BITACORA.md` con el motivo y los
   números de evidencia.

## 6. Después de la ventana (semanas siguientes)

- [ ] Observación **O1**: decidir si `despachada_en` debe marcar la primera o la última aprobación
      y ajustar el SQL (cambio pequeño, con su prueba).
- [ ] Observación **O2**: validar en "Editar despacho" que el pago no supere el total (interfaz +
      Worker).
- [ ] **DROP coordinado** de las 4 RPCs obsoletas (`obtener_stock_comprometido`, `_detalle`,
      `crear_nota_despacho`, `anular_despacho_atomico`) — solo cuando el release haya rodado sin
      incidentes (plan §4.3 del Release 17).
- [ ] Portar el Lote ERP al árbol de staging (`construacero-staging/`) si se quiere paridad para
      el E2E; hoy staging conserva la pestaña Crédito sin "Cuadre".
- [ ] E2E 123/123 de staging sigue **bloqueado por credenciales** (`STAGING_E2E_EMAIL` /
      `STAGING_E2E_PASSWORD`); desbloquearlo daría la última red de seguridad para futuros
      releases.

## 7. Evidencia ya reunida (21-oct-2026)

- **Instalador de producción probado en seco contra la base real (SOLO lectura):** veredicto
  **"LISTO PARA LA VENTANA"** — 6 firmas reemplazables vivas, función nueva y columnas ausentes
  (estado limpio), operador "Desarrollador" validado, huellas SHA-256 de los 4 artefactos
  coincidentes. Detalle: `tmp/release17-produccion-dryrun-2026-10-22-00-07-30.json`.

- Release 17: 8 pruebas por la interfaz de staging, todas conformes —
  `docs/operaciones/verificacion-r17-lote-erp-staging-2026-10-21.md` (+ 3 capturas).
- Lote ERP: arreglo del cableado verificado por interfaz con datos de montos conocidos
  (18 comprobaciones: KPIs $30.00/$150.00/$30.00, cuadre 30+150−30=150 "Saldo actual coincide",
  Movimientos (3), columnas de Clientes que cierran) — capturas en `tmp/cxc-reporte-ui/`.
- Gates de código: 673/673 pruebas, build OK, ESLint sin errores.
