# OP-2026-044: descarga (solo lectura) de los 12 clientes de la captura
import json, sys
sys.path.insert(0, '.')
from lib import q
CODS = ['219442','889387','311301','830206','311543','910654','566021','155297','441897','387665','475109','506944']
OUT = '../../../.tmp-op040/op044/'
cl = q('prod', "select * from clientes where codigo_cliente in (%s)" % ','.join("'%s'" % c for c in CODS))
ids = [c['id'] for c in cl]
A = "array[%s]::uuid[]" % ','.join("'%s'" % i for i in ids)
d = q('prod', f"select n.*, (select coalesce(sum(total_linea_usd),0) from notas_despacho_items i where i.despacho_id=n.id) items_usd from notas_despacho n where cliente_id = any({A}) or cliente_factura_id = any({A}) order by creado_en")
c = q('prod', f"select c.*, n.numero desp_num from cuentas_por_cobrar c left join notas_despacho n on n.id=c.despacho_id where c.cliente_id = any({A}) order by c.creado_en")
dids = [x['id'] for x in d]
DA = "array[%s]::uuid[]" % ','.join("'%s'" % i for i in dids)
dev = q('prod', f"select * from despacho_devoluciones where despacho_id = any({DA})")
cond = ' or '.join(["t ilike '%%%s%%'" % i for i in ids + dids])
aud = q('prod', f"select * from (select a.*, to_jsonb(a)::text t from auditoria a) a where {cond} order by ts")
for a in aud: a.pop('t', None)
json.dump({'cl': cl, 'd': d, 'c': c, 'dev': dev, 'aud': aud}, open(OUT + 'data.json', 'w', encoding='utf-8'), default=str, indent=1, ensure_ascii=False)
print(len(cl), len(d), len(c), len(dev), len(aud))
