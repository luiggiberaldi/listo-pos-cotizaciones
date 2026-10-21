# 17_backup_cuerpos — pre-imágenes de funciones antes del apply del release 17

Guarde aquí el cuerpo ACTUAL (previo al apply) de cada función que el
`17_egreso_inventario_aprobacion_apply.sql` reemplaza. Estos archivos son la
única forma de restaurar la semántica previa (descuento al entregar) en un
rollback.

## Generar las pre-imágenes (psql / SQL Editor, ANTES del apply)

```sql
SELECT pg_get_functiondef('public.aprobar_despacho_inventario_atomico(uuid,uuid,text,text,boolean)'::regprocedure) \gset
-- o, más simple, uno por archivo:
COPY (SELECT pg_get_functiondef(p.oid))
TO STDOUT;
```

Con psql, la forma cómoda es:

```bash
psql "$DATABASE_URL" -c "SELECT pg_get_functiondef('public.aprobar_despacho_inventario_atomico(uuid,uuid,text,text,boolean)'::regprocedure)" -o 17_backup_cuerpos/aprobar_despacho_inventario_atomico.live.sql
psql "$DATABASE_URL" -c "SELECT pg_get_functiondef('public.confirmar_entrega_inventario_atomica(uuid,uuid,text,text,numeric,boolean)'::regprocedure)" -o 17_backup_cuerpos/confirmar_entrega_inventario_atomica.live.sql
psql "$DATABASE_URL" -c "SELECT pg_get_functiondef('public.revertir_entrega_inventario_atomica(uuid,text,uuid,text,text)'::regprocedure)" -o 17_backup_cuerpos/revertir_entrega_inventario_atomica.live.sql
psql "$DATABASE_URL" -c "SELECT pg_get_functiondef('public.editar_despacho_profundidad(uuid,jsonb)'::regprocedure)" -o 17_backup_cuerpos/editar_despacho_profundidad_2args.live.sql
psql "$DATABASE_URL" -c "SELECT pg_get_functiondef('public.editar_despacho_profundidad(uuid,jsonb,uuid,text,text)'::regprocedure)" -o 17_backup_cuerpos/editar_despacho_profundidad_5args.live.sql
psql "$DATABASE_URL" -c "SELECT pg_get_functiondef('public.editar_despacho_profundidad(uuid,jsonb,uuid,text,text,text)'::regprocedure)" -o 17_backup_cuerpos/editar_despacho_profundidad_6args.live.sql
```

## Restaurar (rollback)

Ejecutar cada `.live.sql` guardado después de
`17_egreso_inventario_rollback_review.sql`. Los archivos contienen
`CREATE OR REPLACE FUNCTION` completos, por lo que basta correrlos tal cual.
Verifique con `17_egreso_inventario_postflight_readonly.sql` que los comentarios
de propiedad (`Main egreso-inventario release 17...`) desaparecieron, lo que
confirma que los cuerpos previos quedaron instalados.
