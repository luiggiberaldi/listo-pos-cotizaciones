# OP-2026-044: detalle de las pistas (solo lectura)
import json, sys
sys.path.insert(0, '.')
from lib import q
D = json.load(open('../../../.tmp-op040/op044/data.json', encoding='utf-8'))
byn = {x['numero']: x for x in D['d']}
NUMS = [3401, 977, 4775, 4841, 4281, 4280, 1550, 1551, 1552, 1553, 1555, 2978, 2977, 1850, 1861, 3346, 4800, 4211, 3000, 4512, 3136, 1529, 1612, 3466, 3576, 224, 519, 3063]
for n in NUMS:
    x = byn.get(n)
    if not x: print('no', n); continue
    print('\n### #%s %s %s total=%s creado=%s act=%s' % (n, x['estado'], (D and next(c['nombre'] for c in D['cl'] if c['id'] == x['cliente_id'])), x['total_usd'], x['creado_en'][:16], x['actualizado_en'][:16]))
    print('   fp:', x['forma_pago'], '| ref:', x['referencia_pago'], '| motivo_anul:', x['motivo_anulacion'], '| motivo_dev:', x['motivo_devolucion'], '| notas:', x['notas'], '| aprobado:', x['aprobado_por_nombre'])
    items = q('prod', f"select nombre_snap,cantidad,precio_unit_usd,total_linea_usd from notas_despacho_items where despacho_id='{x['id']}'")
    print('   items:', [(i['nombre_snap'][:30], i['cantidad'], i['precio_unit_usd']) for i in items])
    for a in [a for a in D['aud'] if a['entidad_id'] == x['id'] or (a['meta'] or {}).get('cotizacion_id') == x['cotizacion_id'] or x['id'] in json.dumps(a['meta'] or {})]:
        m = a['meta'] or {}
        print('   AUD', a['ts'][:16], a['usuario_nombre'], a['accion'], {k: m[k] for k in m if k in ('estado_anterior', 'estado_nuevo', 'forma_pago', 'total_usd', 'total_nuevo', 'motivo', 'monto_usd', 'referencia')}, (a['descripcion'] or '')[:100])
dv = q('prod', "select d.*, n.numero from despacho_devoluciones d join notas_despacho n on n.id=d.despacho_id where n.numero in (3346,4800,4211,2185,3064,1703,1861,2724)")
print('\nDEVOLUCIONES'); [print(json.dumps(v, default=str, ensure_ascii=False)[:900]) for v in dv]
print(q('prod', "select string_agg(column_name,',') from information_schema.columns where table_name='despacho_devolucion_intercambios'"))
iv = q('prod', "select i.*, n.numero from despacho_devolucion_intercambios i join despacho_devoluciones d on d.id=i.devolucion_id join notas_despacho n on n.id=d.despacho_id where n.numero in (3346,4800,4211)")
print('INTERCAMBIOS'); [print(json.dumps(v, default=str, ensure_ascii=False)[:600]) for v in iv]
# abonos repetidos por referencia en toda la base
r = q('prod', "select c.referencia, c.monto_usd, c.creado_en, cl.nombre, cl.codigo_cliente from cuentas_por_cobrar c join clientes cl on cl.id=c.cliente_id where c.tipo='abono' and (c.referencia ilike '%ALEJANDRO CUEVA%' or (c.monto_usd=139 and c.referencia ilike '%enzo%') or (c.monto_usd=1000 and c.referencia ilike 'ENZO CONFIRMO%')) order by c.creado_en")
print('\nREFERENCIAS'); [print(v) for v in r]
