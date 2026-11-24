# OP-2026-047: escenario temporal de prueba en STAGING (cuenta principal).
# Copia el patron del despacho de prueba #3501 (cuenta de pruebas) a un cliente
# temporal "PRUEBA OP047 ABONOS": despacho entregado a credito por $634 con
# items SIN producto (no mueven inventario), su cargo y un "Cruce" suelto que lo
# cubre (el patron de Decoraciones Encendo).
# Uso: python escenario042.py crear | limpiar | estado
import sys
import uuid
from lib import *

M = '5b15e0c1-6e2c-4fea-8132-c0673ad38ca0'          # cuenta principal de staging
SRC_DESP = '9e73a1a6-1019-4715-9f6c-2cebd0aeb9a7'   # despacho de prueba #3501
NOMBRE = 'PRUEBA OP047 ABONOS'
ids_file = 'escenario047_ids.json'


def cols(t, excluir=()):
    return [r['column_name'] for r in q('staging', f"select column_name from information_schema.columns where table_schema='public' and table_name='{t}' and is_generated='NEVER' order by ordinal_position") if r['column_name'] not in excluir]


def ins(t, rows, excluir=()):
    c = cols(t, excluir)
    cl = ",".join(f'"{x}"' for x in c)
    j = json.dumps(rows, ensure_ascii=False)
    return f"insert into {t} ({cl}) select {cl} from json_populate_recordset(null::{t}, $J${j}$J$::json);"


def crear():
    vend = q('staging', f"select id from usuarios where cuenta_id='{M}' and activo and rol in ('vendedor','supervisor','jefe') order by nombre limit 1")[0]['id']
    admin = q('staging', f"select id from usuarios where cuenta_id='{M}' and activo and rol in ('administracion','jefe') order by nombre limit 1")[0]['id']
    desp = q('staging', f"select row_to_json(n) r from notas_despacho n where id='{SRC_DESP}'")[0]['r']
    cot = q('staging', f"select row_to_json(c) r from cotizaciones c where id='{desp['cotizacion_id']}'")[0]['r']
    citems = q('staging', f"select coalesce(json_agg(i),'[]') r from cotizacion_items i where cotizacion_id='{cot['id']}'")[0]['r']
    ditems = q('staging', f"select coalesce(json_agg(i),'[]') r from notas_despacho_items i where despacho_id='{SRC_DESP}'")[0]['r']
    cli = q('staging', f"select row_to_json(c) r from clientes c where id='{desp['cliente_id']}'")[0]['r']

    ids = {'cliente': str(uuid.uuid4()), 'cotizacion': str(uuid.uuid4()), 'despacho': str(uuid.uuid4()),
           'cargo': str(uuid.uuid4()), 'cruce': str(uuid.uuid4()), 'citems': [], 'ditems': []}
    cli.update(id=ids['cliente'], nombre=NOMBRE, cuenta_id=M, vendedor_id=vend, ultima_reasig_por=None,
               saldo_pendiente=0, saldo_a_favor=0, codigo_cliente='OP047T', rif_cedula=None, activo=True)
    cot.update(id=ids['cotizacion'], cliente_id=ids['cliente'], vendedor_id=vend, cuenta_id=M,
               transportista_id=None, vehiculo_id=None, cotizacion_raiz_id=None)
    for it in citems:
        it.update(id=str(uuid.uuid4()), cotizacion_id=ids['cotizacion'], cuenta_id=M, producto_id=None)
        ids['citems'].append(it['id'])
    desp.update(id=ids['despacho'], cotizacion_id=ids['cotizacion'], cliente_id=ids['cliente'], cliente_factura_id=None,
                cuenta_id=M, vendedor_id=vend, creado_por=vend, transportista_id=None, vehiculo_id=None)
    for it in ditems:
        it.update(id=str(uuid.uuid4()), despacho_id=ids['despacho'], cuenta_id=M, producto_id=None, editado_por=None)
        ids['ditems'].append(it['id'])
    total = float(desp['total_usd'])
    cxc = [
        {'id': ids['cargo'], 'cliente_id': ids['cliente'], 'despacho_id': ids['despacho'], 'tipo': 'cargo', 'monto_usd': total,
         'saldo_usd': total, 'descripcion': f'Orden de despacho (Crédito) — {NOMBRE}', 'registrado_por': admin,
         'cuenta_id': M, 'creado_en': desp['creado_en'], 'metodo_pago': 'cxc'},
        {'id': ids['cruce'], 'cliente_id': ids['cliente'], 'despacho_id': None, 'tipo': 'abono', 'monto_usd': total,
         'saldo_usd': 0, 'forma_pago_abono': json.dumps([{'metodo': 'Cruce', 'monto': total, 'referencia': 'NO PROCEDE'}]),
         'referencia': 'NO PROCEDE', 'descripcion': 'PRUEBA OP042: cruce manual por la misma devolucion', 'registrado_por': admin,
         'cuenta_id': M, 'metodo_pago': 'cxc'},
    ]
    sql = "begin; set local session_replication_role = replica;\n" + "\n".join([
        ins('clientes', [cli]),
        ins('cotizaciones', [cot], excluir=('numero',)),
        ins('cotizacion_items', citems),
        ins('notas_despacho', [desp], excluir=('numero',)),
        ins('notas_despacho_items', ditems),
        ins('cuentas_por_cobrar', cxc[:1]),
    ]) + "\ncommit;"
    q('staging', sql)
    q('staging', f"update cuentas_por_cobrar set monto_usd=monto_usd where id='{ids['cargo']}'")  # dispara recalculo
    json.dump(ids, open(ids_file, 'w'))
    estado()


def estado():
    ids = json.load(open(ids_file))
    print(q('staging', f"select n.numero, n.estado, n.total_usd, c.nombre, c.saldo_pendiente, c.saldo_a_favor from notas_despacho n join clientes c on c.id=n.cliente_id where n.id='{ids['despacho']}'"))
    for r in q('staging', f"select tipo, monto_usd, forma_pago_abono, referencia, despacho_id is not null enlazado from cuentas_por_cobrar where cliente_id='{ids['cliente']}' order by creado_en"):
        print('  ', r)
    print('   devoluciones:', q('staging', f"select count(*) from despacho_devoluciones where despacho_id='{ids['despacho']}'"))


def limpiar():
    ids = json.load(open(ids_file))
    d, c, k = ids['despacho'], ids['cliente'], ids['cotizacion']
    q('staging', f"""begin; set local session_replication_role = replica;
      delete from cuentas_por_cobrar where cliente_id='{c}';
      delete from despacho_devolucion_intercambios where despacho_id='{d}';
      delete from despacho_devoluciones where despacho_id='{d}';
      delete from notas_despacho_items where despacho_id='{d}';
      delete from comisiones where despachoid='{d}';
      delete from notas_despacho where id='{d}';
      delete from cotizacion_items where cotizacion_id='{k}';
      delete from cotizaciones where id='{k}' or (cliente_id='{c}');
      delete from clientes where id='{c}';
      commit;""")
    quedan = q('staging', f"select (select count(*) from clientes where id='{c}') cli, (select count(*) from notas_despacho where id='{d}') desp, (select count(*) from cuentas_por_cobrar where cliente_id='{c}') cxc, (select count(*) from cotizaciones where cliente_id='{c}') cot")
    print('restos del escenario:', quedan)


{'crear': crear, 'limpiar': limpiar, 'estado': estado}[sys.argv[1]]()
