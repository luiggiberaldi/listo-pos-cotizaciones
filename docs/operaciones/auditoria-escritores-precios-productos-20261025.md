# Auditoría — ¿qué flujos escriben los precios de los productos?

**Fecha:** 2026-10-25
**Alcance:** proyecto principal (producción `oyfyuszgjwcepjpngclv`) y staging (`spupqgkdsgohxxfoxydl`), verificado contra los **cuerpos vivos** de ambas bases (lo que realmente está ejecutándose) más el rastreo del código de los dos proyectos.

---

## En resumen

- **Los flujos de despachos, devoluciones y transformaciones NO escriben precios.** Todos ellos solo mueven existencias (stock) y registran el movimiento en el kardex. Esto se verificó función por función en las bases reales, no solo en el código.
- **Solo tres caminos escriben precios de venta**, y los tres pertenecen a la ficha del producto: editar un producto, crear un producto, y el ingreso de lote.
- De esos tres, el **ingreso de lote** era el que causaba "el precio cambiado vuelve al antiguo": ya está reparado en staging y con la reparación lista (pero pendiente de aplicar) en producción.
- Las devoluciones/intercambios guardan una **fotografía del precio de la venta** en su propio documento (por eso los PDFs muestran esos precios), pero eso es un registro histórico: **no toca** el precio del producto.

---

## Quién escribe precios de venta (verificado en las bases reales)

Barrido a todas las funciones de la base (`pg_proc`): solo estas escriben columnas de precios (`precio_usd`, `precio_2`, `precio_3`, porcentajes) sobre la tabla `productos`:

| Función | Qué hace | Staging | Producción |
|---|---|---|---|
| `actualizar_producto_con_kardex` | Editar producto (ficha de Inventario) | ✅ contrato correcto (migración 279 aplicada: vaciar limpia, precio 0 válido) | ✅ CORREGIDO 2026-10-25 (tarde): su cuerpo YA cumple el contrato (es el de la migración 173: envío directo `precio_2 = p_precio_2` y `precio_usd = COALESCE(...,0)`); verificación por huella md5 del cuerpo vivo. Además ya NO se usa (ver nota al pie) |
| `actualizar_producto_con_kardex_tenant_safe` | Editar producto vía Worker (`/api/productos/actualizar`) | Existe en la base pero la app no lo usa | ⚠️ pendiente la migración 280 |
| `ingresar_lote_inventario_atomico` | Ingreso de lote (compras/ajustes masivos) | ✅ reparado (278: ya no pisa precios de existentes) | ⚠️ pendiente la migración 279 (todavía pisa precios de productos existentes) |

Detalles importantes:

1. **Ingreso de lote**: los precios solo se fijan al **crear** el producto. Un ingreso de lote a un producto existente únicamente suma existencias (y puede actualizar el costo si el operador lo marca explícitamente). Esto es el arreglo 278/279.
2. **Edición de producto**: vaciar un precio lo limpia (NULL), y el precio 0 es un precio real. En staging esto ya funciona de punta a punta.
3. **Matiz de staging**: la pantalla de edición llama a `actualizar_producto_con_kardex_staging`, que solo verifica que el producto sea de tu cuenta y **delega** en `actualizar_producto_con_kardex` (la que quedó arreglada). La reparación cubre el camino real que usa la gente.

## Otros escritores de precios (a propósito, no son bugs)

| Camino | Qué hace | Riesgo |
|---|---|---|
| **Actualización masiva de precios** (botón admin, `handleBatchPriceUpdate` / ModalBatchPrice) | Recalcula precios de venta de muchos productos a la vez (por porcentaje o valor fijo) | Ninguno — es la herramienta diseñada para eso |
| **Alta de producto / importación** (`/api/productos/crear`, ImportadorModal) | Fija los precios al crear el artículo | Ninguno — es el momento legítimo de fijarlos |
| **`/api/productos/metadatos`** | Escribe los interruptores `precio2_habilitado` / `precio3_habilitado` (mostrar/ocultar Precio 2/3) | No cambia los valores, solo su visibilidad |
| Escrituras directas de la app a la tabla `productos` | Solo `activo` e `imagen_url` (en staging; en producción ya pasan por metadatos) | Ninguno — no tocan precios |

## Flujos verificados como "solo existencias" (cuerpos vivos, ambos ambientes)

Cada uno tiene su `UPDATE productos` revisado: todos tocan únicamente `stock_actual` (y `actualizado_en`).

**Despachos:**
- `crear_nota_despacho` (crear despacho) — solo stock ✅
- `aprobar_despacho_inventario_atomico` (aprobar) — solo stock ✅
- `actualizar_estado_despacho` (cambio de estado, ruta legada) — solo stock ✅
- `confirmar_entrega_inventario_atomica` (entrega) — solo stock ✅
- `editar_despacho_profundidad` (edición profunda) — solo stock ✅
- `anular_despacho_atomico` — solo stock ✅
- `revertir_despacho_inventario_atomica` / `revertir_entrega_inventario_atomica` — solo stock ✅

**Devoluciones e intercambios:**
- `registrar_devolucion_inventario_atomica` (devolución parcial + intercambio en entrega) — solo stock ✅. Guarda `precio_unit_usd` como **fotografía** en los documentos `despacho_devoluciones` y `despacho_devolucion_intercambios` (por eso los PDFs de devolución muestran el precio de la venta), pero **jamás escribe precios del producto**.
- `devolver_prestamo_inventario_atomico` (préstamos/devoluciones de stock) — solo stock ✅

**Transformaciones y movimientos manuales:**
- `transformar_inventario_atomico` — solo stock (origen y destino) ✅
- `aplicar_movimiento_inventario_atomico` / `aplicar_movimiento_lote` — solo stock ✅
- `revertir_movimiento_inventario_atomico` — solo stock ✅

**Disparadores (triggers) sobre `productos`:** solo dos, y ninguno toca precios:
- `trg_productos_updated` — actualiza el sello de tiempo.
- `trg_set_cuenta_id_productos` — asigna la cuenta (tenant) al crear.

## Conclusión

No hay ningún flujo "silencioso" tocando precios: el universo de escritores de precios es exactamente el esperado (ficha de producto + ingreso de lote + herramienta de actualización masiva). El bug del "precio que volvía" tenía una única raíz (el ingreso de lote), ya reparada en staging. Lo que queda es **aplicar las migraciones 279 y 280 en producción** para cerrar allí los dos problemas conocidos (ingreso de lote pisa precios; vaciar un precio no limpia).

## Cómo se verificó

- Barrido de `pg_proc` (cuerpos vivos) en ambas bases buscando sentencias `UPDATE public.productos` que mencionen columnas de precios → solo las 3 funciones de la tabla principal.
- Lectura directa de la sentencia `UPDATE` de cada flujo de despacho/devolución/transformación → todas limitadas a `stock_actual`.
- Inventario de triggers sobre `productos` → ninguno escribe precios.
- Rastreo del código de ambos proyectos (SQL de migraciones/releases, Worker/API y pantallas) → escrituras de precios solo en los caminos listados.

## Corrección y verificación posterior (2026-10-25, tarde)

La fila de `actualizar_producto_con_kardex` (16 parámetros) decía «vaciar aún no limpia» en
producción. **Era incorrecto**, y quedó verificado con huella y datos:

- Su cuerpo vivo es **byte a byte el de la migración 173** (md5 normalizado idéntico), que
  ya trae el contrato de precios: envío directo (`precio_2 = p_precio_2`) y precio 0 = 0.
  Es decir: «vaciar limpia» y «precio 0 válido» ya cumplen por ese camino.
- **La función ya no se usa en producción.** Evidencias: (1) permisos — solo `service_role`
  puede ejecutarla (`authenticated`/`anon` no), o sea la app ya no puede ni llamarla;
  (2) código — la app y el Worker usan `/api/productos/actualizar` →
  `actualizar_producto_con_kardex_tenant_safe`; (3) datos — los movimientos de kardex del
  tipo «Ajuste de stock al editar producto» sin sello de idempotencia (la forma de escribir
  de esta variante) terminan el **2026-08-18**; desde el 24-08 todos llevan el sello de la
  ruta Worker/tenant_safe (último: 2026-10-22); (4) memoria de consultas — sus llamadas
  reales (RPC con `p_id, p_codigo, …`) son de abril–agosto 2026 (ruta antigua del navegador).
- La guarda de precios (`281_guarda_precios_ddl.sql`) la protege igualmente: su próxima
  re-definición deberá llevar el marcador del arreglo (o el pase autorizado).

*Herramienta: conector Supabase (consultas de solo lectura). Sesión del 2026-10-25.*
