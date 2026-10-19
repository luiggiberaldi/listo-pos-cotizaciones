# Plan — Inhabilitar Precio 2 y/o Precio 3 por producto

> **Fecha:** 2026-10-18 · **Estado:** APLICADO EN PRODUCCIÓN — migraciones 276 + 277 aplicadas y verificadas (postflight 2026-10-19, evidencia `docs/operaciones/apply-276-277-2026-10-19-00-40-27.md`) · Vitest 521/521 + build OK
> **Requerimiento:** inhabilitar el Precio 2 (Mayor) y/o el Precio 3 (Especial) desde la **edición de artículos**, para los roles que tienen disponible esa función. Un precio inhabilitado **no aparece** en cotizaciones, venta rápida ni inventario; los valores guardados **se conservan**.

## Regla de negocio

1. **Alcance del interruptor:** por producto, en el formulario de edición de artículos (`ProductoForm`). Precio 1 siempre está habilitado.
2. **Roles:** solo llegan al formulario los roles con función de edición de artículos (`supervisor`, `administracion`, `jefe`, `desarrollador`); el Worker valida estos roles en crear/actualizar/metadatos. El toggle viaja con esa misma puerta.
3. **Comportamiento:** un precio inhabilitado desaparece de toda superficie de venta — cotizaciones, venta rápida, inventario, autocomplete, lista de precios PDF — para todos los roles. El formulario de edición (superficie de gestión) sigue mostrando el valor con la tarjeta en estado "Inhabilitado".
4. **Datos:** los valores `precio_2` / `precio_3` **nunca se borran**; solo dejan de ofrecerse. Al re-habilitar reaparecen intactos. Productos existentes quedan habilitados por `DEFAULT TRUE` (cero cambios de comportamiento hasta que se toque un toggle).

## Diseño (por capas)

| Capa | Cambio |
|---|---|
| **BD** — `supabase/migrations/276_precio_2_3_habilitado.sql` | Columnas `precio2_habilitado` / `precio3_habilitado BOOLEAN NOT NULL DEFAULT TRUE`. `obtener_productos_vendedor` devuelve `precio_2/precio_3` como **NULL** cuando el precio está inhabilitado (ocultamiento real para vendedores, en paralelo al `costo_usd` que esa RPC ya oculta). `buscar_productos_hibrido` expone los 2 flags en su retorno (DROP + CREATE porque cambia el tipo de retorno). |
| **Escritura** — `api/handlers/inventario.js` → `/api/productos/metadatos` | Los flags se guardan por el mismo canal que `activo` e `imagen_url` (service_role, validación booleana, tenant-check, auditoría). **Las RPCs crear/actualizar producto NO cambian de firma** → rollout sin riesgo de que un Worker viejo resetee toggles. |
| **Lectura** — Worker | Búsqueda híbrida: para roles no privilegiados los precios inhabilitados se vuelven `null` (igual que `costo_usd`). Catálogos de parseo WhatsApp/escaneo: mismos flags + ocultamiento en el mapeo. |
| **Frontend** — `src/utils/preciosHabilitados.js` | Helpers `precio2Visible(p)` / `precio3Visible(p)`: un precio es visible si tiene valor **y** su flag no es `false` (defensivo: flag ausente = habilitado). |
| **Frontend** — superficies | Todos los puntos que construyen mapas `{p1,p2,p3}` o muestran niveles honran el helper: VentaRapidaView (mapa + match de precio), CotizacionBuilder (mapa), CotizacionCesta/CotizacionBuscador (auto-ocultan por mapa), ProductoCard, ProductoDetalleModal, ProductCard, ProductoAutocomplete (badges "N precios"), ListaPreciosModal (columna del PDF). |
| **Frontend** — `ProductoForm.jsx` | Toggle "Activo / Inhabilitado" en las tarjetas Precio 2/3 (rolswitch, accesible); inputs bloqueados en estado inhabilitado con la tarjeta atenuada; submit persiste flags por metadatos solo cuando cambian (creación: solo si arrancan en `false`). |
| **Compatibilidad de rollout** | App nueva contra BD sin migrar: el select de `productos` degrada a un select compatible sin los flags (PostgREST 400 por columnas inexistentes), y los catálogos del Worker reintentan igual; los flags ausentes = habilitado (comportamiento previo). Usar el toggle antes de aplicar 276 devuelve un error claro (503 "migración 276 pendiente"). BD nueva contra app vieja es seguro porque las RPCs de escritura no cambiaron de firma. |

## Archivos tocados

- `supabase/migrations/276_precio_2_3_habilitado.sql` (+ `276_..._rollback.sql`)
- `api/handlers/inventario.js`
- `src/utils/preciosHabilitados.js` (nuevo) · `src/utils/__tests__/preciosHabilitados.test.js` (nuevo)
- `src/hooks/useInventario.js` · `src/components/inventario/{ProductoForm,ProductoCard,ProductoDetalleModal,ListaPreciosModal}.jsx`
- `src/components/shared/ProductCard.jsx` · `src/components/cotizaciones/{ProductoAutocomplete,CotizacionBuilder}.jsx` · `src/views/VentaRapidaView.jsx`
- `src/utils/__tests__/rpcProductContract.test.js` (aserción de contrato, aditiva) · `.gitignore` (whitelist del test)

## Rollout (orden)

1. **✅ HECHO — aplicar `276` y luego `277`** (2026-10-19, Management API): postflight verde — columnas 2/2 con DEFAULT TRUE, `buscar_productos_hibrido` rechaza `p_cuenta_id NULL` (400 `CUENTA_REQUERIDA`), grants mínimos (buscar solo `service_role`), 466 productos sin cambios. Evidencia: `docs/operaciones/apply-276-277-2026-10-19-00-40-27.md`.
2. **Deploy del Worker + frontend** (un solo deploy; el Worker viejo contra BD nueva es seguro porque las RPCs de escritura no cambian).
3. Smoke: crear/editar un producto como supervisor → apagar Precio 2 → verificar que desaparece en inventario, venta rápida y cotización, y que el valor sigue en la edición.

**Rollback:** `276_precio_2_3_habilitado_rollback.sql` (restaura los cuerpos previos de las 2 RPCs y elimina las columnas — advierte: pierde el estado de los toggles, no los valores). A nivel app basta reverter el commit.

## Verificación ejecutada

- `npm test` (vitest run): **39 archivos, 520/520 tests, exit 0** (incluye los 5 nuevos de `preciosHabilitados` y la aserción de contrato ampliada).
- `npx vite build`: **exit 0**.
- Prueba en vivo (dev) contra la BD real sin migrar: detectó el 400 del select con columnas inexistentes; se reparó con la degradación compatible (fila "Compatibilidad de rollout") y se re-ejecutaron tests + build en verde sobre el árbol final.
- Nota de flakiness: la primera corrida completa tuvo 1 fallo en `operatorSessionIntegration.test.js` (hook de esbuild con timeout de 10s bajo carga paralela); aislada pasó 46/46 y la re-ejecución completa quedó 520/520. No relacionado con este cambio (su grafo de imports no incluye los archivos tocados).

## Auditoría (hallazgos)

1. **✅ Ocultamiento en dos capas.** Vendedores: la RPC de productos devuelve NULL en los valores inhabilitados (enforcement en servidor). Roles privilegiados: el frontend oculta en presentación (el valor sigue disponible en la edición, que es lo pedido).
2. **✅ Hallazgo preexistente RESUELTO en la migración 277** (`277_tenant_obligatorio_rpcs_productos.sql`): `buscar_productos_hibrido` tenía EXECUTE por defecto a `PUBLIC` (¡también `anon`!) y aceptaba `p_cuenta_id NULL` = todos los tenants, exponiendo `costo_usd`, precios y stock entre cuentas. Endurecida con tenant obligatorio (`CUENTA_REQUERIDA`), rechazo de cuentas ajenas cuando hay JWT (`CUENTA_NO_AUTORIZADA`) y EXECUTE solo para `service_role` (el Worker). Además `obtener_productos_vendedor` (misma clase de fuga: SECURITY DEFINER sin filtro de cuenta, saltaba las políticas RLS) quedó filtrada por `p.cuenta_id = auth.uid()`, el mismo modelo de tenant de la RLS de productos (migraciones 104/132).
3. **Decisiones de alcance:** la actualización masiva de precios (`ModalBatchPrice`) sigue actualizando valores de precios inhabilitados (son mantenimiento de valores, que se conservan por diseño). Documentos históricos (ítems de despachos/devoluciones existentes) no se tocan: mantienen su precio de venta original.
4. **Contratos:** las RPCs crear/actualizar producto no cambiaron de firma (a prueba de deploys desfasados); el contrato RPC del Worker quedó cubierto por `rpcProductContract.test.js`.
5. **Seguridad del handler de metadatos:** solo roles con edición de artículos, validación de booleanos, verificación de tenant y auditoría de cada cambio de toggle.

## Próximos pasos sugeridos

- Aplicar la migración 276 en ventana y hacer el smoke de 3 pantallas.
- Espejo de la migración en el checkout de staging cuando se promueva.
- ~~Endurecer `buscar_productos_hibrido`~~ — hecho en la migración 277 (aplicar junto con 276).
