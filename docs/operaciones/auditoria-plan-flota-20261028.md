# Auditoría — Avance del plan de Flota (vehículos) y Choferes Locales

**Fecha:** 2026-10-28
**Plan auditado:** `docs/plans/2026-10-26-plan-flota-vehiculos-choferes.md`
**Dónde está el trabajo:** solo en la copia de pruebas (`construacero-staging/`), sin guardar en el historial de git.

---

## En resumen

- **Vamos aproximadamente al 60 %.** Las fases 1, 2 y 3 (base de datos, servidor y pantallas de
  venta/despacho) están escritas. La **fase 4 (reportes y PDFs) no se ha empezado** y la fase 5
  (pasar a producción) tampoco.
- **Todo compila y las 147 pruebas automáticas pasan**, incluidas las 29 nuevas de flota.
- **Hay un defecto importante que corregir antes de seguir:** al editar un despacho, el sistema
  olvida el camión que tenía ese viaje y le pone el camión habitual del chofer. Eso rompe la regla
  principal del plan ("el historial nunca se reescribe").
- **Nada de esto está guardado todavía** (ni respaldado en git) y los archivos de prueba nuevos
  están excluidos de git: si se pierde la carpeta, se pierden.

---

## 1. Avance por fase

| Fase | Estado | Qué hay |
| :--- | :--- | :--- |
| 1. Base de datos | ✅ Escrita · ❓ aplicación sin confirmar | Migración `283` y su reversa (rollback) en `construacero-staging/supabase/migrations/`. No encontré registro en `docs/operaciones/` de que se haya aplicado en staging, y no tengo permiso para consultar esa base de datos. |
| 2. Servidor (Worker) | ✅ Hecha | Rutas `/api/vehiculos/listar·crear·actualizar·eliminar` y `/api/reportes/flota-choferes`. Baja protegida de choferes (bloquea si tiene fletes pendientes). Registro en bitácora de auditoría. |
| 3. Pantallas | ✅ Hecha (con defectos, ver §2) | Franja "Vehículos de la Empresa" en Transportistas, selector de vehículo habitual en la ficha del chofer, y "Vehículo para este viaje" + casilla "dejar como fijo" en Cotización, Venta rápida, Despachar, Editar despacho y Cambiar transportista. |
| 4. Reportes y PDFs | ❌ No empezada | El servidor ya entrega los datos, pero **no hay pantalla** con el Cuadro 1 (por vehículo) ni el Cuadro 2 (por chofer), ni marca `≈`, ni exportación. Los 3 PDFs (guía, orden y nota de despacho) siguen imprimiendo el camión de la ficha del chofer, no el del viaje. |
| 5. Producción | ❌ No empezada | Falta el paquete `supabase/release/main/283_*` (revisión previa, aplicación, verificación y reversa). Nada del plan está en el código de producción. |

Pruebas del plan (raíl R12): existen `flotaVehiculos.test.js` y `flotaVehiculoContract.test.js`;
**falta** `rpcFlotaReporteContract.test.js` y la prueba manual con dos choferes rotando camiones.

---

## 2. Defectos encontrados (de más a menos grave)

### 2.1 🔴 Editar un despacho le cambia el camión al viaje
La lista de despachos no trae el dato "vehículo del viaje" (`useDespachos.js`, la consulta no pide
`vehiculo_id`). Por eso, al abrir **Editar despacho** o **Cambiar transportista**, el selector
aparece vacío; al guardar (aunque solo se cambie el pago) se envía "sin camión" y la base de
datos rellena con el camión habitual del chofer. Resultado: un viaje que salió en el Camión 3
puede quedar registrado en el Camión 1. **Rompe el raíl R4.**
*Arreglo:* agregar `vehiculo_id` a esa consulta y solo enviar el vehículo si el usuario lo tocó.

### 2.2 🟠 El camión elegido en la cotización se pierde al despachar
Si el vendedor elige un camión en la cotización, al pulsar **Despachar** el selector empieza
vacío y el servidor no copia el camión de la cotización: el viaje queda con el camión habitual.
*Arreglo:* que el despacho herede el camión de la cotización cuando no se indique otro.

### 2.3 🟠 Una corrección manual sigue marcada como "estimada"
Cuando alguien cambia a mano el camión de un viaje viejo (marcado `≈` por la carga histórica),
la marca no se actualiza a "manual". El reporte seguiría mostrándolo como estimado. **Raíl R5.**

### 2.4 🟠 La casilla "dejar como camión fijo" no valida el camión
Al marcarla en venta rápida / despacho / cotización, el servidor guarda el camión como fijo del
chofer **sin comprobar** que sea de la empresa, que esté activo ni que el chofer sea local (la
ficha del chofer sí lo comprueba). Además se guarda *antes* de crear la venta: si la venta falla,
el chofer ya quedó con el camión cambiado. Riesgo bajo en la práctica, pero incumple el raíl R8.

### 2.5 🟡 Cambios de otros trabajos mezclados
En los mismos archivos sin guardar hay arreglos que **no son de flota** (el respaldo de usuario
en `api/lib/auth.js`, `recalcularComision238b` en despachos, el script E2E y la migración `282`).
Conviene guardarlos por separado para que cada cosa pueda revisarse o revertirse sola.

---

## 3. Lo que está bien

- La migración respeta las correcciones del plan: nombres reales de columnas, **nunca borra
  cotizaciones**, la carga histórica queda marcada como estimada y la mercancía se calcula sin
  contar el flete dos veces.
- Solo el servidor puede escribir en la tabla de vehículos; las funciones están cerradas al público.
- Los roles siguen el plan (el supervisor no ve el reporte con comisiones).
- Las pantallas de venta no exigen clics nuevos: el camión se autocompleta (raíl R10).

---

## 4. Pendientes de decisión (del plan, siguen abiertos)

- ¿El supervisor puede ver comisiones? (por defecto: no).
- Capturar a mano la capacidad en kg de los 4 camiones.

## 5. Próximos pasos sugeridos

1. Corregir los defectos 2.1 a 2.4 (son pocos cambios).
2. Guardar el trabajo en git, separando lo de flota de lo demás, y sacar los `*.test.js` de la
   lista de excluidos (o forzar su inclusión).
3. Confirmar/aplicar la migración 283 en staging y dejar registro en `docs/operaciones/`.
4. Fase 4: pantalla de reportes, marca `≈`, exportación y PDFs con el camión del viaje.
5. Fase 5: paquete de producción y ventana autorizada.

---

## 6. Actualización 2026-10-28 (misma fecha, tarde) — errores corregidos y plan retomado

### En resumen
- **Los 4 defectos (2.1 a 2.4) están corregidos** en el código de staging.
- **La fase 4 está hecha:** pantalla de reportes (Cuadro 1 por vehículo y Cuadro 2 por chofer),
  marca `≈`, exportación a PDF y Excel, y los PDFs de despacho imprimen el camión del viaje.
- **Paquete de producción preparado (sin ejecutar)** en `supabase/release/main/283_flota_*`.
- **Sigue sin guardarse en git** y **la migración 283 sigue sin confirmarse en staging**.
  Importante: la web nueva pide datos del camión al listar despachos; si se publica la web
  ANTES de aplicar la 283 en esa base de datos, la lista de despachos falla. Orden obligatorio:
  primero la 283, después el Worker y la web.

### Qué se cambió
| Defecto | Arreglo |
| :--- | :--- |
| 2.1 Editar despacho cambiaba el camión | La lista de despachos ahora trae el camión del viaje; los modales solo envían el camión si el usuario lo tocó. El servidor solo cambia el camión si se lo piden, o si cambia el chofer (entonces pone el habitual del nuevo chofer). |
| 2.2 Se perdía el camión de la cotización | El despacho hereda el camión de la cotización si es el mismo chofer, y el modal de despacho lo muestra precargado. |
| 2.3 Corrección manual seguía "≈" | Toda elección a mano se guarda como `manual`; vaciar el camión deja que la base vuelva a poner el habitual. |
| 2.4 "Dejar como fijo" sin validar | Se valida que el camión sea de la cuenta y esté activo, y que el chofer sea local. Se aplica **después** de crear la venta/despacho; si falla, la venta queda y sale un aviso. El camión del viaje también se valida contra la cuenta en venta rápida, despacho y edición. |

### Fase 4 — archivos nuevos
- `src/components/reportes/SeccionFlotaChoferes.jsx` (dentro de Reportes → Transportistas, con el mismo filtro de fechas).
- `src/services/pdf/flotaChoferesPDF.js` (en el PDF la marca es `~`, porque la letra del PDF no tiene `≈`).
- `src/utils/flotaReporte.js` (totales, `≈`, Excel en formato CSV con coma decimal) y `src/utils/vehiculoImpreso.js` (camión del viaje en guía, orden y nota de despacho).
- Prueba nueva `src/utils/__tests__/rpcFlotaReporteContract.test.js` (incluye el escenario de dos choferes rotando camiones).

### Fase 5 — paquete preparado (NO ejecutado)
`283_flota_preflight_readonly.sql` (solo lectura: revisa columnas, qué choferes no tienen placa y una huella del dinero),
`283_flota_vehiculos_locales_apply.sql` y `283_flota_vehiculos_locales_rollback_review.sql` (ambos con compuerta
`REVIEW_ONLY`, que hay que quitar a propósito en la ventana autorizada) y `283_flota_postflight_readonly.sql`
(la huella del dinero debe salir idéntica a la del preflight). Falta además pasar el código del Worker y la web a la
carpeta de producción, en la misma ventana.

### Lo que todavía falta
1. Guardar en git (separando lo de flota de lo demás) y sacar los `*.test.js` de la lista de excluidos.
2. Aplicar/confirmar la 283 en staging y probar a mano: dos choferes rotando camiones, editar el pago de un despacho
   (el camión no debe cambiar) y los PDFs.
3. Decisiones: supervisor y comisiones (por defecto no); capacidad en kg de los 4 camiones.
4. Ventana de producción.
