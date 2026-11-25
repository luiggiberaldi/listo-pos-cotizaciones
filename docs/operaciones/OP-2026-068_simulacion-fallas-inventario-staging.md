# OP-2026-068 — Simulación en vivo de las fallas de inventario (`N25`–`N35`) en staging

**Fecha:** 2026-11-24  
**Entorno probado:** **Staging** (`spupqgkdsgohxxfoxydl`, copia de pruebas) — **0 cambios en producción** y **0 cambios en el código de la app**.  
**Caso relacionado:** [OP-2026-067](OP-2026-067_auditoria-logica-y-flujos-inventario-e2e.md) · [Registro de fallas](REGISTRO-FALLAS-CODIGO.md)

---

## En resumen

- **¿Ya están auditados todos los flujos y registradas todas las fallas?** **Sí.** En una segunda pasada sobre Venta Rápida (`VentaRapidaView.jsx`), movimientos por lote (`MovimientoLoteModal.jsx`) y devolución parcial (`DevolucionParcialModal.jsx`) apareció **una falla grave adicional (`N35`)**: si un cliente devuelve por "Devolución parcial" un artículo que salió como préstamo en un despacho mixto, el sistema le regala saldo a favor por algo que no pagó y además permite devolver el préstamo dos veces. Con `N35`, el catálogo completo de inventario queda en **11 fallas (`N25`–`N35`)**: **5 graves, 4 importantes y 2 menores**.
- **¿Son reales y qué tan graves son?** Las **10 fallas simulables en staging (`N25`–`N31`, `N33`–`N35`) se confirmaron en vivo** usando productos, cliente y despachos temporales de prueba (`SIM068-*`), y **`N32`** se confirmó en el código. Las pruebas demostraron creación de **mercancía fantasma**, **desaparición de ventas concurrentes**, **regalo de dinero en saldo a favor**, **pérdida de piezas de intercambio** y **enlaces rotos al borrar productos**.
- **Detalle importante descubierto al simular (limites reales):**
  - En **`N35`**, si el despacho tiene **solo** el préstamo (`$0`), la base frena el error porque no deja que el total quede en negativo (`-50`). Pero si el despacho es **mixto** (lleva mercancía paga + préstamo), **pasa sin freno** y genera el dinero y stock fantasma.
  - En **`N29`**, si un reintento intenta devolver **más** de lo vendido (`3 + 3` de `5`), la base sí lo frena (`SALDO_DEVOLUCION_INVALIDO`); pero si devuelve una cantidad que aún cabe (`2 + 2` de `5`), **duplica** el reingreso y el dinero acreditado porque la pantalla no envía huella única (`Idempotency-Key`).
  - En **`N26`**, en staging salió un problema adicional: la función que revierte movimientos en el Kardex (`revertir_movimiento_inventario_atomico`) respondió **permiso denegado (HTTP 403)** incluso para el servidor por un permiso faltante de la migración 275.
- **Limpieza garantizada:** al terminar la simulación se borraron todos los datos de prueba y se verificó **`0` registros residuales** en todas las tablas de staging.

---

## 1. Tabla maestra de simulaciones en staging (`N25`–`N35`)

> **Qué es staging:** la copia de pruebas de construacero (`spupqgkdsgohxxfoxydl`). Ningún dato de clientes reales ni de producción (`oyfyuszgjwcepjpngclv`) fue tocado.

| Falla | Gravedad | Qué simulamos en staging | Qué debería pasar | Qué pasó realmente en staging | ¿Confirmada? |
|---|---|---|---|---|---|
| **N25** | 🔴 Grave | Producto en `100`; se vende `-10` (queda `90`), y otro usuario guarda un cambio de nombre enviando el `100` viejo | Seguir en **`90`** | Regresó a **`100`** y anotó un ingreso falso de **`+10`** (`Ajuste de stock al editar producto`) | ✅ **Sí** |
| **N26** | 🔴 Grave | Consultar el historial como lo hace la pantalla del Kardex (`useKardex`) e intentar revertir un ajuste manual | Traer `origen_tipo` para ocultar "Revertir" en devoluciones/cortes, y permitir revertir solo ajustes manuales | La pantalla **no pide `origen_tipo`** (`presente = false`) aunque la base sí lo guarda; además en staging `revertir_movimiento_inventario_atomico` dio **HTTP 403 (`permission denied`)** incluso para el servidor | ✅ **Sí (+ bloqueo extra en staging)** |
| **N27** | 🔴 Grave | Despacho con préstamo de `5` und (`es_prestamo = true`), aprobado/entregado y luego devuelto por Préstamos | Salir a **`45`** al entregar y volver a **`50`** al devolver | Al entregar quedó en **`50`** (no bajó); al devolver sumó **`+5`** y subió a **`55`** (**`+5` fantasma**) | ✅ **Sí** |
| **N35** | 🔴 Grave | **Nueva.** Despacho mixto (ítem pago `$100` + préstamo `4` und ref. `$25`, stock `50`). Devolución parcial de `2` del préstamo y luego devolución del préstamo (`4`) | Impedir devolver un préstamo por "Devolución parcial" | En despacho `$0` la base frena total negativo; en despacho **mixto pasó**: stock subió a **`52`**, cliente ganó **`$50` de saldo a favor gratis**, préstamo siguió `pendiente` y al devolverlo subió a **`56`** (**`+6` fantasma**) | ✅ **Sí** |
| **N28** | 🔴 Grave | **5a:** Despacho de `10` (queda `30`), devuelven `3` y se llevan `2` de intercambio (`pA=33`, `pInt=18`), reabren a `despachada` y pasan a `pendiente`. **5b:** Edición profunda `10 → 7` tras devolver `3` | **5a:** volver a `40` y `20`. **5b:** quedar en `33` (`40 - 7`) | **5a:** `pA` saltó a **`43`** (**`+3` fantasma**) y `pInt` siguió en **`18`** (**`2` perdidos**). **5b:** `pB` saltó a **`36`** (**`+3` fantasma**) | ✅ **Sí** |
| **N29** | 🟠 Importante | Enviar dos veces seguidas una devolución parcial de `2` und sobre `5` vendidos con claves distintas (simulando pantalla sin `Idempotency-Key` ante mala señal) | La segunda petición con la misma huella debe ignorarse y acreditar solo `2` und / `$20` | Pasaron **las dos**: stock subió de `45` a **`49`** (`4` devueltas en vez de `2`) y cliente ganó **`+$40`** en vez de `+$20`. *(Si intenta `3 + 3 > 5`, la base sí frena con `SALDO_DEVOLUCION_INVALIDO`)* | ✅ **Sí** |
| **N30** | 🟠 Importante | Probar acceso directo en Supabase sin pasar por el servidor (clave anónima y sesión de vendedor E2E) | Cerrado por completo para escritura/lectura directa innecesaria | En staging, el catálogo anónimo responde **HTTP 401** y `aplicar_movimiento_lote` exige rol `administracion`; pero `notas_despacho_items` y `cliente_prestamos` responden **HTTP 200** a sesiones autenticadas. *(En producción siguen abiertas también las 3 funciones heredadas)* | ✅ **Sí (con diferencia vs producción)** |
| **N31** | 🟠 Importante | **8a:** Dos filas de intercambio del mismo producto (`2 + 3`, stock `45`), cliente devuelve `1` (`46`) y se reabre a `pendiente`. **8b:** Dos aprobaciones en paralelo pidiendo `4` c/u sobre stock `5` | **8a:** reingresar `4` y quedar en **`50`**. **8b:** no dejar bajar de `0` | **8a:** quedó en **`49`** (solo reingresó `3` de `4`, **se perdió `1` unidad**). **8b:** ambas aprobaron en paralelo y dejaron el stock en **`-3`** | ✅ **Sí** |
| **N32** | 🟠 Importante | Compras/Órdenes de compra y respaldo/restauración JSON | Compras sumando al almacén y respaldo completo | **Confirmada en el código** (sin mutación destructiva): Órdenes de compra y CxP no tocan stock; respaldo/restauración no incluye `inventario_movimientos` ni `cliente_prestamos` | ✅ **Código** |
| **N33** | 🟡 Menor | **9a:** Borrar producto en negativo (`-5` tras venta de `10` sobre `5`). **9b:** Desactivar producto (`activo = false`) en stock `6` y anular su despacho | **9a:** no borrar si tiene historial ni romper enlace. **9b:** permitir reingreso al anular | **9a:** borró físicamente la fila (`null`), dejó `notas_despacho_items.producto_id = null` y anotó cierre `'egreso' 5` (`-5 → 0`). **9b:** falló con `PRODUCTO_NO_DISPONIBLE` y no devolvió las `4` und (`stock` siguió en `6`) | ✅ **Sí** |
| **N34** | 🟡 Menor | **10a:** Guardar cantidad `1.1234` en despacho. **10b:** Ingresar lote con 2 filas del mismo producto (`+5` y `+3`) | Conservar `1.1234` y sumar `+8` en el lote | **10a:** guardó **`1.12`** (recortó 2 decimales). **10b:** rechazó el lote completo con `PRODUCTO_REPETIDO_EN_INGESTA` | ✅ **Sí** |

---

## 2. Qué significa la nueva falla `N35` (y por qué importa tanto)

Durante la revisión minuciosa del flujo de **Venta Rápida** (`api/handlers/cotizaciones.js`, `src/views/VentaRapidaView.jsx`) y **Devolución Parcial** (`src/components/despachos/DevolucionParcialModal.jsx`, `api/handlers/despachos.js`, `225_devolucion_parcial_inventario_atomica.sql`), vimos este agujero grave:

1. Cuando un ítem sale marcado como **préstamo** (`es_prestamo = true`), el sistema guarda su precio de referencia (por ejemplo `$25`), aunque la línea cobra **`$0`** al cliente porque es prestado.
2. Sin embargo, ni la pantalla de **Devolución Parcial** ni el servidor ni la base de datos bloquean devolver ese ítem por allí:
   - La pantalla calcula el monto a acreditar usando `cantidad × precio_unit_usd` (`2 × $25 = $50`).
   - En un despacho mixto (con otros productos pagos para que el total del despacho no caiga debajo de `$0`), la base ejecuta la devolución, suma `+2` al inventario y le abona **`$50` de saldo a favor al cliente por mercancía que nunca pagó**.
   - Encima, la tabla `cliente_prestamos` **ni se entera** y sigue diciendo que el cliente debe `4` unidades prestadas; si después devuelve el préstamo por el módulo de Préstamos, el sistema suma otras `+4` unidades (**`+6` fantasma en total** sobre las `50` iniciales).

---

## 3. Verificación de limpieza y entorno

- **Script ejecutado:** `scripts/op068-simular-fallas-inventario-staging.mjs` (con bloqueo de seguridad que aborta si `SUPABASE_URL` no contiene el identificador de staging `spupqgkdsgohxxfoxydl`).
- **Resultado técnico guardado en:** `tmp/op068-results.json` (`"runError": null`, código de salida `0`).
- **Registros remanentes en staging después del borrado automático:**

| Tabla verificada | Registros `SIM068` restantes |
|---|---|
| `productos` | `0` |
| `clientes` | `0` |
| `cotizaciones` | `0` |
| `notas_despacho` | `0` |
| `notas_despacho_items` | `0` |
| `cliente_prestamos` | `0` |
| `cuentas_por_cobrar` | `0` |
| `despacho_devoluciones` | `0` |
| `inventario_movimientos` (incluidos huérfanos tras `N33`) | `0` |

---

## 4. Qué sigue

Todas las fallas ya están **confirmadas con números reales en staging**. El siguiente paso recomendado es empezar a **reparar primero las 5 fallas graves (`N25`, `N26`, `N27`, `N28`, `N35`) en staging**, probar cada arreglo con este mismo guion automatizado y validar contigo dos reglas de negocio antes de tocar nada:
1. Cómo manejar el campo de existencia al editar un producto (`N25`: quitarlo de esa pantalla o pedir motivo aparte validando el stock actual).
2. Confirmar que todo **préstamo** descuenta del inventario al aprobar/entregar (`N27`) y queda bloqueado para devolución parcial (`N35`).
