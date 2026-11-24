# OP-2026-059 — Ensayo de las REVERSAS sobre staging: aplica 301-309, luego las reversas 309-301, y
# compara el resultado con producción (huella md5 de las funciones). Todo dentro de una transacción que
# se deshace (ROLLBACK): staging queda igual. Nunca toca producción (solo la lee).
import os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'OP-2026-040_scripts'))
from lib import q
from ensayo_staging import MIG, ORDEN, sin_transaccion

def leer(n): return sin_transaccion(open(os.path.join(MIG, n + '.sql'), encoding='utf-8').read())
prod = {r['k']: r['h'] for r in q('prod', "select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' k, md5(pg_get_functiondef(p.oid)) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('ajustar_finanzas_devolucion_neta','registrar_devolucion_parcial_cobro_idempotente')")}
sql = 'begin;\n' + '\n'.join(leer(n) for n in ORDEN) + '\n' + '\n'.join(leer(n + '_rollback') for n in reversed(ORDEN)) + r"""
do $$ begin raise exception 'RESULTADO_REVERSAS %', (select json_build_object(
  'funciones', (select json_object_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('ajustar_finanzas_devolucion_neta','registrar_devolucion_parcial_cobro_idempotente')),
  'nuevas_que_quedan', (select count(*) from pg_proc where proname in ('reabrir_despacho_con_pagos','anular_despacho_con_pagos','editar_despacho_profundidad_con_cxc','devolucion_con_donacion','cxc_anular_movimiento','cxc_registrar_abono_atomico','cxc_saldo_favor_atomico','cxc_pagos_en_juego_despacho','cxc_reparto_cliente','cxc_pendiente_despacho','trg_archivar_cxc_borrado')),
  'tabla_archivo', (select count(*) from information_schema.tables where table_name='cxc_movimientos_borrados'),
  'columna_clave', (select count(*) from information_schema.columns where table_name='cuentas_por_cobrar' and column_name='idempotency_key'),
  'disparador', (select count(*) from pg_trigger where tgname='trg_archivar_cxc_borrado'))); end $$;
rollback;"""
try:
    q('staging', sql)
except SystemExit as e:
    t = str(e).replace('\\"', '"')
    m = re.search(r'RESULTADO_REVERSAS (\{.*?\})(?:\\n|\n)CONTEXT', t)
    import json
    res = json.loads(m.group(1)) if m else t
    print('Tras aplicar y deshacer en staging:', res)
    if isinstance(res, dict):
        print('Funciones iguales a producción:', res['funciones'] == prod)
