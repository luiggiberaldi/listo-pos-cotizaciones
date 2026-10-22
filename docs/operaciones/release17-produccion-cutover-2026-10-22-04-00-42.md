# Cutover release 17 (egreso al aprobar) en PRODUCCIÓN — 2026-10-22T04:00:20.823Z

- Proyecto: `oyfyuszgjwcepjpngclv` (principal) · Resultado: **PASS**
- Aplicado por: scripts/apply-release17-produccion.mjs (Management API HTTPS)
- Modo: already
- Operador del backfill (autor del kardex de migración): MIGRACIÓN release 17 · `00000000-0000-0000-0000-000000000000`
- Pre-imágenes: `supabase/release/main/17_backup_cuerpos_produccion/*.live.sql` (0 cuerpos)
- Rollback: `supabase/release/main/17_egreso_inventario_rollback_review.sql` (guards + reingreso espejo del backfill)
- Evidencia JSON: `tmp\release17-produccion-evidence-2026-10-22-04-00-42.json`

## Aserciones
- ✅ PRE: conexión a producción OK
- ✅ PRE: firma reemplazable viva para aprobar_despacho_inventario_atomico(uuid,uuid,text,text,boolean)
- ✅ PRE: firma reemplazable viva para confirmar_entrega_inventario_atomica(uuid,uuid,text,text,numeric,boolean)
- ✅ PRE: firma reemplazable viva para revertir_entrega_inventario_atomica(uuid,text,uuid,text,text)
- ✅ PRE: firma reemplazable viva para editar_despacho_profundidad(uuid,jsonb,uuid,text,text,text)
- ✅ PRE: firma reemplazable viva para editar_despacho_profundidad(uuid,jsonb,uuid,text,text)
- ✅ PRE: firma reemplazable viva para editar_despacho_profundidad(uuid,jsonb)
- ✅ PRE: el operador del backfill existe y está activo en el destino (00000000-0000-0000-0000-000000000000)
- ✅ PRE: función NUEVA revertir_despacho_inventario_atomica(uuid,text,uuid,text,text) presente (coherente con release instalado)
- ✅ PRE: estado previo reconocido (listo / backfill-pendiente / ya instalado)
- ✅ POSTFLIGHT: ejecutado sin errores
- ✅ BACKFILL: ejecutado sin errores
- ✅ BACKFILL: re-ejecución sin errores (sin doble efecto)
- ✅ POSTFLIGHT: ejecutado sin errores
- ✅ POST: marcador release 17 en aprobar_despacho_inventario_atomico(uuid,uuid,text,text,boolean)
- ✅ POST: marcador release 17 en confirmar_entrega_inventario_atomica(uuid,uuid,text,text,numeric,boolean)
- ✅ POST: marcador release 17 en revertir_entrega_inventario_atomica(uuid,text,uuid,text,text)
- ✅ POST: marcador release 17 en revertir_despacho_inventario_atomica(uuid,text,uuid,text,text)
- ✅ POST: marcador release 17 en editar_despacho_profundidad(uuid,jsonb,uuid,text,text,text)
- ✅ POST: EXECUTE solo service_role en las RPCs del release
- ✅ POST: 0 despachos sin lote salvo los obsoletos decididos (#1930, #1933, #2144)
- ✅ POST: backfill sin efecto doble (ningún par lote+producto repetido)
- ✅ POST: columnas nuevas presentes (egreso_lote_id, alerta_stock, alerta_stock_items)
- ✅ AVISO confirmar_entrega_inventario_atomica: su rama de entrega directa sí egresa por diseño (no es regresión)
- ✅ SMOKE: hay despachos reales con lote de egreso (el backfill dejó huella)

## Etapas
### PRE 1: conexión (2026-10-22T04:00:21.791Z)
```
[{"db":"postgres","ts":"2026-10-22 04:00:19.975714+00"}]
```
### PRE 2: firmas vivas (2026-10-22T04:00:22.589Z)
```
[{"proname":"aprobar_despacho_inventario_atomico","args":"p_despacho_id uuid, p_usuario_id uuid, p_usuario_nombre text, p_usuario_color text, p_solo_validar boolean"},{"proname":"confirmar_entrega_inventario_atomica","args":"p_despacho_id uuid, p_usuario_id uuid, p_usuario_nombre text, p_usuario_color text, p_tasa_snapshot numeric, p_permitir_negativo boolean"},{"proname":"editar_despacho_profundidad","args":"p_despacho_id uuid, p_nuevos_items jsonb"},{"proname":"editar_despacho_profundidad","args":"p_despacho_id uuid, p_nuevos_items jsonb, p_usuario_id uuid, p_usuario_nombre text, p_usuario_rol text"},{"proname":"editar_despacho_profundidad","args":"p_despacho_id uuid, p_nuevos_items jsonb, p_usuario_id uuid, p_usuario_nombre text, p_usuario_rol text, p_forma_pago text"},{"proname":"revertir_despacho_inventario_atomica","args":"p_despacho_id uuid, p_nuevo_estado text, p_usuario_id uuid, p_usuario_nombre text, p_usuario_color text"},{"proname":"revertir_entrega_inventario_atomica","args":"p_despacho_id uuid, p_nuevo_estado text, p_usuario_id uuid, p_usuario_nombre text, p_usuario_color text"}]
```
### PRE 3: columnas nuevas del release (2026-10-22T04:00:23.301Z)
```
[{"n":3}]
```
### PRE 4: operador del backfill (MIGRACIÓN release 17) (2026-10-22T04:00:24.074Z)
```
[{"id":"00000000-0000-0000-0000-000000000000","nombre":"Desarrollador","rol":"desarrollador"}]
```
### PRE 5: conteos previos (2026-10-22T04:00:24.776Z)
```
[{"despachos_cerrados":1824,"kardex_total":6590,"stock_total":"255611.00"}]
```
### PRE 5b: despachos pendientes de egreso (backfill) (2026-10-22T04:00:25.465Z)
```
[{"backfill_objetivos":0}]
```
### PLAN: despachos "en vuelo" y su descuento (2026-10-22T04:00:26.129Z)
```
[{"numero":1930,"unidades":"60.00"},{"numero":1933,"unidades":"3.00"},{"numero":2144,"unidades":"8.00"}]
```
### PLAN: entregadas que solo se sellan (sin tocar stock) (2026-10-22T04:00:26.803Z)
```
[{"n":0}]
```
### POSTFLIGHT (read-only): 17_egreso_inventario_postflight_readonly.sql (2026-10-22T04:00:31.614Z)
```
[{"nivel":"NEGATIVO","items":5}]
```
### BACKFILL (operador MIGRACIÓN release 17) (2026-10-22T04:00:32.696Z)
```
[{"id":"f6d825e6-67f7-4e67-af6f-8403642b3a12","numero":217,"estado":"entregada","egreso_lote_id":"98c55ac7-e67d-2d06-0ce0-4262286acb6e","alerta_stock":false,"movimientos_egreso":0,"movimientos_ingreso":0},{"id":"73ad7c23-fed3-4495-880e-654990f09c6e","numero":464,"estado":"entregada","egreso_lote_id":"3e3fdf5d-62ef-dfc3-5830-100c0be23efd","alerta_stock":false,"movimientos_egreso":0,"movimientos_ingreso":0},{"id":"d772535c-1eb3-475a-9579-ff6f2e4621d5","numero":490,"estado":"entregada","egreso_lote_id":"72960f29-f6d8-60c2-bb7f-888c072c3d2b","alerta_stock":false,"movimientos_egreso":0,"movimientos_ingreso":0},{"id":"3bf091be-4f50-462f-b55d-d652d64b2dd2","numero":494,"estado":"entregada","egreso_lote_id":"c6b6aa99-0ff3-993a-cf67-074e598a8f4c","alerta_stock":false,"movimientos_egreso":0,"movimientos_ingreso":0},{"id":"e08deb41-1799-4f1e-b881-eaee746d0fb2","numero":496,"estado":"entregada","egreso_lote_id":"0cf6109a-6fcc-af5d-f09c-737236d12fe0","alerta_stock":false,"movimientos_egreso":0,"movimientos_ingreso":0},{"id":"87014697-c1c5-4309-904c-9640f5dea979","numero":501,"estado":"entregada","egreso_lote_id":"68d99839-90da-9241-343e-a2fc5b9b5e55","alerta_stock":false,"movimientos_egreso":0,
```
### BACKFILL: re-ejecución (idempotencia) (2026-10-22T04:00:33.769Z)
```
[{"id":"f6d825e6-67f7-4e67-af6f-8403642b3a12","numero":217,"estado":"entregada","egreso_lote_id":"98c55ac7-e67d-2d06-0ce0-4262286acb6e","alerta_stock":false,"movimientos_egreso":0,"movimientos_ingreso":0},{"id":"73ad7c23-fed3-4495-880e-654990f09c6e","numero":464,"estado":"entregada","egreso_lote_id":"3e3fdf5d-62ef-dfc3-5830-100c0be23efd","alerta_stock":false,"movimientos_egreso":0,"movimientos_ingreso":0},{"id":"d772535c-1eb3-475a-9579-ff6f2e4621d5","numero":490,"estado":"entregada","egreso_lote_id":"72960f29-f6d8-60c2-bb7f-888c072c3d2b","alerta_stock":false,"movimientos_egreso":0,"movimientos_ingreso":0},{"id":"3bf091be-4f50-462f-b55d-d652d64b2dd2","numero":494,"estado":"entregada","egreso_lote_id":"c6b6aa99-0ff3-993a-cf67-074e598a8f4c","alerta_stock":false,"movimientos_egreso":0,"movimientos_ingreso":0},{"id":"e08deb41-1799-4f1e-b881-eaee746d0fb2","numero":496,"estado":"entregada","egreso_lote_id":"0cf6109a-6fcc-af5d-f09c-737236d12fe0","alerta_stock":false,"movimientos_egreso":0,"movimientos_ingreso":0},{"id":"87014697-c1c5-4309-904c-9640f5dea979","numero":501,"estado":"entregada","egreso_lote_id":"68d99839-90da-9241-343e-a2fc5b9b5e55","alerta_stock":false,"movimientos_egreso":0,
```
### POSTFLIGHT (cierre): 17_egreso_inventario_postflight_readonly.sql (2026-10-22T04:00:34.520Z)
```
[{"nivel":"NEGATIVO","items":5}]
```
### POST: resumen del kardex de migración (2026-10-22T04:00:41.521Z)
```
[{"movimientos_migracion":6,"unidades_migracion":"6330.00"}]
```
### SMOKE: despachos reales con lote de egreso (2026-10-22T04:00:42.254Z)
```
[{"id":"d7342c44-6d94-4ae1-869e-4217c69df978","numero":4161,"estado":"despachada","egreso_lote_id":"ad924cb8-982c-b6dd-ea77-7b9bff4f0def","movimientos":5},{"id":"b80233c4-4e5a-473a-90e5-b907e08f49d8","numero":4160,"estado":"entregada","egreso_lote_id":"efa6134f-9972-e9d3-032c-d6070ca1b889","movimientos":0},{"id":"0a955fff-e099-4007-ad10-c3aa0b38e5be","numero":4157,"estado":"entregada","egreso_lote_id":"64807ebf-ce55-6c3b-041c-fdfc8e160891","movimientos":0}]
```
