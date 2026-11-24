# OP-2026-040: copia los clientes de los casos de CxC de produccion (solo lectura) a staging.
# Uso: python copiar.py            -> solo prepara copia.sql y muestra conteos
#      python copiar.py --ejecutar -> ejecuta la copia en staging (una sola transaccion)
import sys
from lib import *

CUENTA = {'74dd6821-963d-406e-8621-47352e0df27e': '5b15e0c1-6e2c-4fea-8132-c0673ad38ca0'}
ids = json.load(open('ids.json'))
CL = set(ids['clientes'])
D = set(ids['despachos'])


def P(sql):
    return q('prod', sql)


def rows(t, where):
    return P(f"select coalesce(json_agg(x),'[]') j from {t} x where {where}")[0]['j']


def exist(t, v):
    v = [x for x in set(v) if x]
    if not v:
        return set()
    return {r['id'] for r in q('staging', f"select id from {t} where id=any({arr(v)})")}


desp = rows('notas_despacho', f"id=any({arr(D)})")
cots = rows('cotizaciones', f"id=any({arr({d['cotizacion_id'] for d in desp})})")
while True:  # cerrar la cadena de cotizacion_raiz
    extra = {c['cotizacion_raiz_id'] for c in cots if c['cotizacion_raiz_id']} - {c['id'] for c in cots}
    extra -= exist('cotizaciones', extra)
    if not extra:
        break
    cots += rows('cotizaciones', f"id=any({arr(extra)})")
C_ids = {c['id'] for c in cots}
citems = rows('cotizacion_items', f"cotizacion_id=any({arr(C_ids)})")
ditems = rows('notas_despacho_items', f"despacho_id=any({arr(D)})")
devs = rows('despacho_devoluciones', f"despacho_id=any({arr(D)})")
inter = rows('despacho_devolucion_intercambios', f"despacho_id=any({arr(D)})")
cxc = rows('cuentas_por_cobrar', f"cliente_id=any({arr(CL)})")
devs_cot = {d.get('cotizacion_reemplazo_id') for d in devs} - {None} - C_ids
devs_cot -= exist('cotizaciones', devs_cot)
for d in devs:  # reemplazo que no se copia -> se deja vacio (la regla original es SET NULL)
    if d.get('cotizacion_reemplazo_id') in devs_cot:
        d['cotizacion_reemplazo_id'] = None

T_ids = {x['transportista_id'] for x in desp + cots if x.get('transportista_id')}
trans = rows('transportistas', f"id=any({arr(T_ids)})") if T_ids else []
V_ids = {x.get('vehiculo_id') for x in desp + cots} | {t.get('vehiculo_habitual_id') for t in trans}
V_ids.discard(None)
vehs = rows('vehiculos', f"id=any({arr(V_ids)})") if V_ids else []

need = {x.get('cliente_id') for x in desp + cots} | {d.get('cliente_factura_id') for d in desp} | {t.get('empleado_id') for t in trans}
need.discard(None)
need -= CL
need -= exist('clientes', need)
clientes = rows('clientes', f"id=any({arr(CL | need)})")

U = set()
for x in desp + cots + cxc + clientes + trans + citems + ditems + devs + inter:
    for k in ('vendedor_id', 'creado_por', 'registrado_por', 'editado_por', 'ultima_reasig_por'):
        if x.get(k):
            U.add(x[k])
Umiss = U - exist('usuarios', U)
usuarios = rows('usuarios', f"id=any({arr(Umiss)})") if Umiss else []
for u in usuarios:  # sin PIN y desactivado: no se llevan credenciales a staging
    u.update(pin_hash=None, pin_salt=None, activo=False, creado_por=None)

Pr = {x.get('producto_id') for x in citems + ditems + devs + inter}
Pr.discard(None)
Pok = exist('productos', Pr)
nulled = 0
for x in citems + ditems + devs + inter:
    if x.get('producto_id') and x['producto_id'] not in Pok:
        x['producto_id'] = None
        nulled += 1

for lst in (desp, cots, citems, ditems, devs, inter, cxc, trans, vehs, clientes, usuarios):
    for x in lst:
        if x.get('cuenta_id'):
            if x['cuenta_id'] not in CUENTA:
                sys.exit(f"cuenta desconocida {x['cuenta_id']}")
            x['cuenta_id'] = CUENTA[x['cuenta_id']]

plan = [
    ('vehiculos', vehs, 'upd'),
    ('usuarios', usuarios, 'ins'),
    ('clientes', [c for c in clientes if c['id'] in CL], 'upd'),
    ('clientes', [c for c in clientes if c['id'] not in CL], 'ins'),
    ('transportistas', trans, 'ins'),
    ('cotizaciones', cots, 'upd'),
    ('cotizacion_items', citems, 'upd'),
    ('notas_despacho', desp, 'upd'),
    ('notas_despacho_items', ditems, 'upd'),
    ('despacho_devoluciones', devs, 'upd'),
    ('despacho_devolucion_intercambios', inter, 'upd'),
]
for t, l, m in plan:
    print(f"{t:35s} {len(l):5d} {m}")
print('cuentas_por_cobrar', len(cxc), '| productos sin equivalente', nulled,
      '| usuarios nuevos', [u['nombre'] for u in usuarios], '| clientes extra', len(need))


def cols(t):
    return [r['column_name'] for r in P(
        f"select column_name from information_schema.columns where table_schema='public' "
        f"and table_name='{t}' and is_generated='NEVER' order by ordinal_position")]


def J(l):
    s = json.dumps(l, ensure_ascii=False)
    assert '$J$' not in s
    return f"$J${s}$J$::json"


def upsert(t, l, mode):
    c = cols(t)
    cl = ",".join(f'"{x}"' for x in c)
    s = f"insert into {t} ({cl}) overriding system value select {cl} from json_populate_recordset(null::{t},{J(l)})"
    if mode == 'upd':
        cu = [x for x in c if not (t == 'cotizaciones' and x == 'numero')]  # GENERATED ALWAYS: no se puede actualizar
        exc = ",".join(f'excluded."{x}"' for x in cu)
        clu = ",".join(f'"{x}"' for x in cu)
        s += f" on conflict (id) do update set ({clu}) = ({exc})"
    else:
        s += " on conflict (id) do nothing"
    return s + ";"


sql = ["begin;", "set local session_replication_role = replica;"]
for t, l, m in plan:
    if l:
        sql.append(upsert(t, l, m))
sql.append(f"delete from cuentas_por_cobrar where cliente_id=any({arr(CL)}) "
           f"and not (id=any({arr([x['id'] for x in cxc])}));")
sql.append(upsert('cuentas_por_cobrar', cxc, 'upd'))

chk = [
    ("cuentas_por_cobrar", "cliente_id", "clientes"), ("cuentas_por_cobrar", "despacho_id", "notas_despacho"),
    ("cuentas_por_cobrar", "registrado_por", "usuarios"),
    ("notas_despacho", "cliente_id", "clientes"), ("notas_despacho", "cliente_factura_id", "clientes"),
    ("notas_despacho", "cotizacion_id", "cotizaciones"), ("notas_despacho", "vendedor_id", "usuarios"),
    ("notas_despacho", "creado_por", "usuarios"), ("notas_despacho", "transportista_id", "transportistas"),
    ("notas_despacho", "vehiculo_id", "vehiculos"),
    ("cotizaciones", "cliente_id", "clientes"), ("cotizaciones", "vendedor_id", "usuarios"),
    ("cotizaciones", "transportista_id", "transportistas"), ("cotizaciones", "vehiculo_id", "vehiculos"),
    ("cotizaciones", "cotizacion_raiz_id", "cotizaciones"),
    ("cotizacion_items", "cotizacion_id", "cotizaciones"), ("cotizacion_items", "producto_id", "productos"),
    ("notas_despacho_items", "despacho_id", "notas_despacho"), ("notas_despacho_items", "producto_id", "productos"),
    ("notas_despacho_items", "editado_por", "usuarios"),
    ("despacho_devoluciones", "despacho_id", "notas_despacho"),
    ("despacho_devoluciones", "despacho_item_id", "notas_despacho_items"),
    ("despacho_devoluciones", "producto_id", "productos"), ("despacho_devoluciones", "registrado_por", "usuarios"),
    ("despacho_devoluciones", "cotizacion_reemplazo_id", "cotizaciones"),
    ("despacho_devolucion_intercambios", "despacho_id", "notas_despacho"),
    ("despacho_devolucion_intercambios", "producto_id", "productos"),
    ("despacho_devolucion_intercambios", "registrado_por", "usuarios"),
    ("transportistas", "empleado_id", "clientes"), ("transportistas", "vehiculo_habitual_id", "vehiculos"),
    ("clientes", "vendedor_id", "usuarios"), ("clientes", "ultima_reasig_por", "usuarios"),
]
body = " + ".join(
    f"(select count(*) from {a} x where x.{b} is not null and not exists (select 1 from {r} y where y.id=x.{b}))"
    for a, b, r in chk)
sql.append(f"do $D$ declare n int; begin select {body} into n; if n>0 then "
           f"raise exception 'OP040: % referencias rotas, se cancela todo', n; end if; end $D$;")
sql.append("select setval('notas_despacho_numero_seq', greatest((select max(numero) from notas_despacho),(select last_value from notas_despacho_numero_seq)));")
sql.append("select setval('cotizaciones_numero_seq', greatest((select max(numero) from cotizaciones),(select last_value from cotizaciones_numero_seq)));")
sql.append("commit;")
S = "\n".join(sql)
open('copia.sql', 'w', encoding='utf-8').write(S)
print('SQL bytes', len(S.encode()))
if '--ejecutar' in sys.argv:
    print(q('staging', S))
