# OP-2026-050 — ¿Cada movimiento de dinero de CxC tiene su anotación en la auditoría?
# Solo lectura. Uso: python op050_auditoria_cobertura.py prod|staging
import sys, json
from lib import q

env = sys.argv[1] if len(sys.argv) > 1 else 'prod'
DESDE = '2026-10-23'  # fecha desde la que la categoría FINANZAS se guarda (antes fallaba el enum)

# Para cada movimiento: ¿hay alguna fila de auditoría en ±3 min que mencione al cliente o al despacho?
sql = f"""
with mov as (
  select c.id, c.tipo, c.metodo_pago, c.monto_usd, c.creado_en, c.cliente_id, c.despacho_id,
         left(coalesce(c.descripcion,''),40) descr
  from cuentas_por_cobrar c where c.creado_en >= '{DESDE}'
), m as (
  select mov.*,
    exists (select 1 from auditoria a
            where a.ts between mov.creado_en - interval '3 min' and mov.creado_en + interval '3 min'
              and (a.entidad_id = mov.cliente_id or a.entidad_id = mov.despacho_id
                   or a.meta::text like '%' || mov.cliente_id::text || '%'
                   or (mov.despacho_id is not null and a.meta::text like '%' || mov.despacho_id::text || '%'))) con_auditoria,
    (select string_agg(distinct a.accion, ',') from auditoria a
            where a.ts between mov.creado_en - interval '3 min' and mov.creado_en + interval '3 min'
              and (a.entidad_id = mov.cliente_id or a.entidad_id = mov.despacho_id)) acciones
  from mov
)
select tipo, metodo_pago, descr, count(*) n,
       count(*) filter (where con_auditoria) con_auditoria,
       count(*) filter (where not con_auditoria) sin_auditoria,
       round(sum(monto_usd) filter (where not con_auditoria),2) usd_sin_auditoria,
       string_agg(distinct acciones, ' | ') acciones_vistas
from m group by 1,2,3 order by sin_auditoria desc, n desc
"""
filas = q(env, sql)
tot = sum(f['n'] for f in filas); sin = sum(f['sin_auditoria'] for f in filas)
print(f'== {env}: movimientos CxC desde {DESDE}: {tot}; sin ninguna anotación cercana en auditoría: {sin}')
for f in filas:
    print(json.dumps(f, ensure_ascii=False, default=str))

# Borrados: la auditoría no puede verse contra la tabla (la fila ya no existe); contamos acciones de borrado/reversión
print('\n== acciones de auditoría que borran o revierten dinero:')
print(q(env, f"select accion, count(*) n from auditoria where ts >= '{DESDE}' and (accion ilike '%revert%' or accion ilike '%anular%' or accion ilike '%elimin%' or accion ilike '%devol%') group by 1 order by 2 desc"))
