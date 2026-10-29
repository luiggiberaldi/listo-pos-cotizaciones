# Punto de encuentro — Avisos nocturnos (Auditor de saldos + Staging E2E)
**Fecha:** 2026-10-26 · **Estado:** PAUSADO a propósito, listo para retomar

---

## En resumen

Los dos avisos nocturnos de GitHub (el "Auditor de saldos" y el "E2E de Staging")
siguen fallando, pero ya avanzamos bastante:

- **Arreglado y subido:** el aviso del E2E usaba una versión equivocada de Node y
  no compilaba los archivos de la pantalla antes de las pruebas. Esos dos arreglos
  ya están confirmados (commits `5bb96b6` y `36fc3a4`).
- **En camino:** el examen completo (E2E) de staging ya pasa 42 de 123 pasos. Se
  está actualizando para que coincida con las reglas actuales de comisiones
  (el llamado "modelo 238b / R4").
- **Punto exacto donde se pausó:** el paso *"34. Liberar CxC y pagar comisión"*
  falla porque, bajo el modelo nuevo, la comisión nace en estado `generada` y el
  botón de pagar solo acepta comisiones `pendiente` o `cta_cobrar`. Hay que
  decidir cómo debe comportarse ese paso bajo el modelo nuevo (ver detalle abajo).
- **Análisis listo, corrección pendiente:** ya se identificaron los 3 registros de
  comisiones raros que reporta el Auditor (más 1 advertencia). Faltan aplicar las
  correcciones con su red de seguridad.
- **Ya aplicado y verificado:** la migración 282 de staging (permisos de dos
  funciones que el Tester necesita) quedó activa en la base de staging.

---

## 1. Qué está hecho y verificado

| Tarea | Estado |
|---|---|
| Causa raíz del fallo del E2E nocturno (Node viejo + `dist/` sin compilar) | ✅ Arreglada, commits `5bb96b6`, `36fc3a4` (ya en GitHub) |
| Migración 282 en staging (`GRANT` de `obtener_stock_comprometido`, puerta de roles de `tester_cleanup_cotizacion`) | ✅ Aplicada; verificado en vivo: `grant_comprometido=true`, `grant_cleanup=true`, `puerta_roles_jefe=true` |
| Tester E2E actualizado al contrato vivo (base neta R4 → comisión $7.56, estado `generada`, re-resolver la comisión tras cada devolución) | 🔄 Hecho hasta el paso 42; el resto avanza paso a paso |
| Análisis de los registros raros del Auditor | ✅ Hecho (consultas en `scripts/tmp-q30.sql` … `tmp-q33.sql`) |
| Reparación de esos registros con guardas | ⬜ Pendiente |
| Registro en bitácora y matriz de migraciones | ⬜ Pendiente (al cerrar la tarea) |

**Última corrida del E2E local:** 2026-10-26 12:31 UTC — *42/123 pasos, 1 fallo*.
Log: `tmp/e2e-staging/tester-2026-10-26T12-31-03-270Z.log` (carpeta `tmp/`, no se sube a git).

**Aviso:** los cambios locales **aún NO están confirmados (commit) ni subidos**:
- `construacero-staging/scripts/test-e2e-staging.mjs` (modificado — las actualizaciones del tester)
- `construacero-staging/api/lib/auth.js` (modificado — respaldo de "actor" para que las RPCs financieras funcionen con el operador desarrollador virtual; sin esto fallan con `USUARIO_FUERA_DE_TENANT`)
- `construacero-staging/supabase/migrations/282_staging_fix_rpcs_visibilidad_e2e.sql` (archivo nuevo, **sí debe subirse** cuando cerremos)
- `construacero-staging/scripts/apply-282-staging.mjs` (script de aplicación; está excluido de git por regla del proyecto `scripts/*`, es solo local)

Mientras estos cambios no se suban, el aviso nocturno de GitHub seguirá fallando
porque corre la versión vieja del tester.

---

## 2. Dónde quedó exactamente (el bloqueo actual)

**Paso fallido:** `34. Liberar CxC y pagar comisión` →
`POST /api/comisiones/pagar: Comision no encontrada o ya pagada en su totalidad`

**Qué está pasando (versión simple):** el despacho de la prueba se paga 100% a
crédito ("Cta por cobrar"). Con las reglas nuevas de comisiones, una venta a
crédito **no genera comisión cobrable de inmediato**: el monto se guarda aparte
(como "excluida por CxC") y se libera cuando el cliente paga su crédito. Pero el
paso del tester intenta pagar la comisión **antes** de cobrar el crédito, con el
mecanismo viejo.

**Detalle técnico (para retomar sin investigar de nuevo):**

- La comisión de la prueba queda: `estado='generada'`, `totalcomision=0.00`,
  `comision_cxc_excluida=7.56` (base neta R4 $252 × 3%), `comision_retenida=0.00`.
- `commissionStateContract()` en [test-e2e-staging.mjs](construacero-staging/scripts/test-e2e-staging.mjs)
  (≈ línea 143) decide si hace falta "liberación manual" mirando solo
  `comision_retenida`; como es 0, **no** llama a `liberar-cxc` y va directo a `pagar`.
- `handleMarcarComisionPagada()` en [comisiones.js](construacero-staging/api/handlers/comisiones.js)
  (≈ línea 120) actualiza solo filas con `estado IN (pendiente, cta_cobrar)`;
  una fila `generada` no califica → devuelve ese 404.
- `handleLiberarComisionCxc()` (mismo archivo, ≈ línea 201) tampoco sirve tal
  cual: exige `comision_retenida > 0.01` y `estado = 'cta_cobrar'`, y su
  actualización filtra `estado=eq.cta_cobrar`.

**Pregunta abierta que hay que resolver primero:** ¿qué mecanismo vivo libera
`comision_cxc_excluida` cuando se cobra la CxC? La bitácora dice que "se libera
al conciliar/cobrar la CxC", pero no se localizó aún el trigger o endpoint que lo
hace. Revisar: handlers de CxC (`api/handlers/cxc.js`), flujo `editar-pago`, y
triggers sobre `cuentas_por_cobrar` en staging (ojo: la migración 200 de staging
**borró** el trigger viejo `trg_liberar_comision_por_pago`).

**Opciones para el paso 34 (decidir al retomar):**
1. **Alinear el tester al modelo nuevo:** primero registrar el cobro del crédito
   (lo que libere la comisión excluida) y luego pagar. Respeta la regla real.
2. **Extender `liberar-cxc`** para que también maneje `comision_cxc_excluida`
   (estado `generada` → `pendiente`, moviendo el excluido a `comision_liberada`),
   si el producto realmente quiere liberación manual. Debe coincidir con la
   interfaz real.
3. **Afirmar la regla:** una comisión 100% CxC no se puede pagar manualmente
   antes de cobrar; el paso verifica el rechazo y sigue.

---

## 3. Los registros raros del Auditor (análisis hecho, corrección pendiente)

Comisiones con invariantes rotas (consultas de solo lectura: `scripts/tmp-q30.sql`
a `tmp-q33.sql`, se ejecutan con `node scripts/tmp-sql.mjs <archivo>` contra el
proyecto **principal**):

| Comisión (inicio) | Despacho | Problema | Dato clave |
|---|---|---|---|
| `e29648d0…` | #2121 (entregada) | Invariante roto: lo "liberado" supera el total | `totalcomision=$4.33` pero `comision_liberada=$5.27` (sobra $0.94) |
| `caa27157…` | #4020 (entregada, 238b) | Descuadre de centavos entre partes y total | partes=$0.54 vs total=$0.53 |
| `989ac5e7…` | #4179 (entregada, 238b) | Descuadre de centavos entre partes y total | partes=$16.68 vs total=$16.67 |
| `b245cc04…` | #1898 (**anulada**) | Advertencia W2: despacho anulado con comisión viva | comisión `pendiente` $170.64 sin tocar |

Notas para la corrección:
- Los dos descuadres de centavos (4020, 4179) son casos de devolución con
  intercambio (redondeo del factor de escala); conviene corregir el total (o las
  partes) con una guarda que verifique el antes/después y deje evidencia, no un
  `UPDATE` a ciegas.
- `e29648d0` (liberada > total) es el más delicado: hay que revisar su historia
  de `comision_liberaciones` antes de tocar nada (puede haber un pago ya registrado).
- `b245cc04` es solo advertencia: decidir si la comisión de un despacho anulado
  debe anularse/quedarse; documentar la decisión.
- Regla de oro del proyecto: **ninguna corrección en la base sin guarda ni
  respaldo previo** (snapshot + rollback, como en las corridas anteriores).

---

## 4. Qué falta por hacer (orden sugerido)

1. **Resolver la pregunta del mecanismo de liberación de `comision_cxc_excluida`**
   (sección 2) y elegir la opción 1/2/3 para el paso 34 del tester.
2. Terminar de actualizar el tester E2E al modelo Release 17 + contrato R4/238b
   y correrlo completo hasta dejarlo en verde (123/123).
3. Confirmar (commit) y subir: tester, `api/lib/auth.js` (respaldo de actor) y la
   migración 282. Sin esto el aviso nocturno de GitHub no mejora.
4. Reparar los 3 registros del Auditor con guardas (y decidir la advertencia W2).
5. Verificar que ambos avisos nocturnos quedan en verde en GitHub (el del
   Auditor: run `40318490235`; el E2E: run `40310250072` — ambos fallidos hoy
   antes de estos arreglos).
6. Cierre documental: entrada en [BITACORA.md](BITACORA.md) y fila en
   [matriz-migraciones.md](docs/operaciones/matriz-migraciones.md) por la 282.

## 5. Cómo retomar (comandos útiles)

```bash
# Correr el E2E de staging completo (usa credenciales de construacero-staging/.env)
cd construacero-staging && node scripts/test-e2e-staging.mjs

# Consultas de solo lectura contra el proyecto principal (Auditor)
node scripts/tmp-sql.mjs scripts/tmp-q30.sql

# Estado de git antes de continuar
git status
```

Los scripts `scripts/tmp-q*.sql` y `scripts/tmp-policies-staging.mjs` son
borradores de diagnóstico (excluidos de git); se pueden borrar al cerrar.
