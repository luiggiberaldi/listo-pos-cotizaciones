# Informe — Edición profunda mostraba el artículo viejo (caso DES-04243)

**Fecha:** 23 de octubre de 2026
**Entorno donde se arregló:** staging (copia de pruebas)
**Estado:** arreglado, probado en staging y **promovido al código principal** (24/10/2026).
Falta solo desplegarlo a producción.

## En resumen

- El despacho **DES-04243 no tenía datos duplicados ni corruptos**. El problema era de
  "cómo se mira": la ventana de **edición profunda** leía el registro ORIGINAL del
  despacho en vez del resultado final del cambio de artículo, así que mostraba
  "PRUEBA BORRAR" (el artículo viejo) cuando ya correspondía "prueba 2 borrar" (el del cambio).
- **Arreglo en staging (3 correcciones):** ahora la edición profunda carga los artículos
  reales (netos del cambio), y al guardar retira el registro del cambio con **bitácora**
  para que la vista nunca duplique artículos.
- **Probado con una simulación completa del caso** (crear → entregar → cambio de artículo →
  devolver el despacho → edición profunda → re-entregar): **20 de 20 verificaciones pasaron**,
  incluyendo el cierre del inventario (cada artículo se descuenta una sola vez).
- El inventario y el dinero del caso real **ya estaban bien**; no hubo que tocar dinero.
- **Siguiente paso:** promover el arreglo al entorno principal (pasos al final).

## Qué pasó en el caso real (DES-04243)

1. Se creó el despacho con 5 unidades de **"PRUEBA BORRAR"** y se entregó.
2. En la entrega, el cliente devolvió esas 5 unidades y se le cambiaron por 5 de
   **"prueba 2 borrar"**. Todo quedó registrado correctamente.
3. Se "devolvió" el despacho (volvió a pendiente) para hacer una edición profunda.
4. Al abrir la edición profunda, aparecía **"PRUEBA BORRAR"** en vez de **"prueba 2 borrar"**.

## La causa (explicada simple)

Imagina la orden de despacho como una **ficha de entrega** y el cambio de artículo como una
**nota pegada al lado** que dice "se cambió X por Y".

- La pantalla de edición profunda miraba solo la **ficha** (que todavía decía "PRUEBA BORRAR")
  y no la **nota** del cambio.
- Peor aún: si se guardaba así, la ficha quedaba con el artículo viejo y la nota seguía
  pegada, entonces la vista **mostraba los dos artículos a la vez (duplicado)**. Esto es
  exactamente el mismo problema que ya había pasado con el despacho DES-04161 (las cabillas
  de 6 m y las de 12 m aparecían juntas).

## El arreglo (en staging)

1. **La edición profunda ahora carga los artículos reales** (la ficha + la nota del cambio,
   todo sumado/restado): muestra "prueba 2 borrar", que es lo que el cliente realmente tiene.
   → Archivo: `construacero-staging/src/components/despachos/EditarItemsDespachoModal.jsx`
2. **Al guardar la edición, se retira la "nota" del cambio** (el registro de
   devolución/intercambio), porque ya quedó incluida en los artículos guardados. El retiro
   queda en la **bitácora de auditoría** con la acción
   `EDICION_PROFUNDA_RETIRA_DEVOLUCIONES`. Así la vista nunca puede volver a duplicar.
   → Archivo: `construacero-staging/api/handlers/despachos.js`
3. **Detalle de presentación:** si el artículo del cambio se registró sin código, ahora se
   muestra el código del producto para que la línea no salga en blanco.
   → Archivo: `construacero-staging/src/services/despachoItemsService.js`

## Cómo se probó

- **Pruebas unitarias** (80/80 pasan), incluida una regresión del caso DES-04161 y las nuevas:
  - `construacero-staging/src/services/__tests__/despachoItemsService.test.js`
  - `construacero-staging/api/handlers/__tests__/editarItemsRetiraDevoluciones.test.js`
  - `construacero-staging/src/components/despachos/__tests__/EditarItemsDespachoModal.test.js`
- **Build de staging:** compila sin errores.
- **Simulación completa del caso DES-04243 en staging** (20/20 verificaciones):
  `construacero-staging/scripts/test-des-04243-devolucion-edicion.mjs`
  - La edición muestra SOLO el artículo del cambio (nunca el viejo). ✓
  - Al guardar: los artículos quedan exactamente en el cambio (sin duplicados), el registro
    del cambio se retira, `tiene_devoluciones` queda en false y la bitácora se registra. ✓
  - **Inventario cerrado:** el artículo viejo nunca se descuenta neto (queda en 100) y el del
    cambio se descuenta UNA sola vez (50 → 45). ✓
  - La reversión ("devolver el despacho") también quedó verificada: devuelve el inventario
    al punto de partida antes de la edición.

## Qué NO cambió

- El dinero y las cuentas por cobrar del caso real estaban bien; no se tocó nada financiero.
- Los datos del DES-04243 (en el entorno principal) **no necesitan corrección manual**: cuando
  se promueva el arreglo, al abrir la edición profunda de ese despacho aparecerá
  "prueba 2 borrar" y al guardarla se retirará sola la nota del cambio.

## Promoción al entorno principal (completada el 24/10/2026)

1. ✅ Los 3 cambios se copiaron al proyecto principal:
   `src/components/despachos/EditarItemsDespachoModal.jsx`, `api/handlers/despachos.js` y
   `src/services/despachoItemsService.js` (más sus 3 pruebas).
2. ✅ Pruebas del proyecto principal: **720/720 pasan** (incluye la regresión DES-04161 y
   las nuevas DES-04243).
3. ✅ Build del proyecto principal: compila sin errores.

## Siguiente paso: desplegar a producción

1. Desplegar con el runbook `docs/runbooks/deploy-produccion.md`.
2. Prueba rápida con el caso DES-04243 real: abrir la edición profunda de ese despacho
   (debe aparecer "prueba 2 borrar", no "PRUEBA BORRAR") y guardarla; la vista no debe
   duplicar artículos y la bitácora debe registrar `EDICION_PROFUNDA_RETIRA_DEVOLUCIONES`.
