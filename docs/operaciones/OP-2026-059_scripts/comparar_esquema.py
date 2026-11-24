# OP-2026-059 — Comparación de solo lectura del esquema de producción contra staging
# para preparar el paso a producción de las migraciones 300-308 de CxC.
# Usa lib.py de OP-2026-040 (bloquea cualquier escritura en producción).
import sys, json, hashlib, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'OP-2026-040_scripts'))
from lib import q

FUNCS = ['cxc_%', 'ajustar_finanzas_devolucion%', 'registrar_devolucion_inventario_atomica', 'reservar_operacion_inventario', 'guardar_operacion_inventario', 'staging_%operacion%', 'registrar_devolucion_parcial%', 'revertir_entrega_finanzas%',
         'editar_despacho_profundidad%', 'reabrir_despacho%', 'anular_despacho%', 'devolucion_con_donacion%',
         'trg_archivar_cxc_borrado', 'recalcularcomisiondespacho%', 'validar_pagos_diferencia_devolucion',
         'registrar_cobro_diferencia_devolucion', 'trg_recalcular_saldo_pendiente%', 'actualizar_estado_despacho%']

def funcs(env):
    cond = ' or '.join(f"p.proname like '{f}'" for f in FUNCS)
    return q(env, f"""select p.proname, pg_get_function_identity_arguments(p.oid) args,
                     md5(pg_get_functiondef(p.oid)) h
                     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and ({cond}) order by 1,2""")

if __name__ == '__main__':
    out = {}
    for env in ('prod', 'staging'):
        r = {}
        r['funcs'] = funcs(env)
        r['enum'] = q(env, "select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='categoria_auditoria' order by e.enumsortorder")
        r['cols'] = q(env, "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='cuentas_por_cobrar' order by ordinal_position")
        r['tablas'] = q(env, "select table_name from information_schema.tables where table_schema='public' and table_name in ('cxc_movimientos_borrados','auditoria','cuentas_por_cobrar','clientes','notas_despacho') order by 1")
        r['vistas'] = q(env, "select table_name from information_schema.views where table_schema='public' and table_name like 'v_cxc%'")
        r['triggers_cxc'] = q(env, "select tgname from pg_trigger where tgrelid='public.cuentas_por_cobrar'::regclass and not tgisinternal order by 1")
        r['indices_cxc'] = q(env, "select indexname from pg_indexes where schemaname='public' and tablename='cuentas_por_cobrar' order by 1")
        r['politicas_cxc'] = q(env, "select policyname, cmd from pg_policies where schemaname='public' and tablename in ('cuentas_por_cobrar','auditoria') order by 1")
        r['cols_auditoria'] = q(env, "select column_name from information_schema.columns where table_schema='public' and table_name='auditoria' order by ordinal_position")
        r['cols_despacho'] = q(env, "select column_name from information_schema.columns where table_schema='public' and table_name='notas_despacho' and column_name in ('forma_pago','forma_pago_cliente','cliente_factura_id','motivo_anulacion','total_usd','tiene_devoluciones') order by 1")
        out[env] = r
    json.dump(out, open(os.path.join(os.path.dirname(__file__), 'comparacion_esquema.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print('ok')
