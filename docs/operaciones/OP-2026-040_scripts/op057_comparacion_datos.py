# OP-2026-057 (M4) — Descarga de STAGING (solo lectura) los datos para comparar la regla de la pantalla con la de la base:
# movimientos de todos los clientes, reparto calculado por la base (cxc_reparto_cliente) y saldos guardados.
# Uso: python op057_comparacion_datos.py staging  → escribe ../../../.tmp-op040/op057_comparacion.json
import sys, json
from lib import q

env = sys.argv[1] if len(sys.argv) > 1 else 'staging'
movs = q(env, "select id, cliente_id, despacho_id, tipo, monto_usd, metodo_pago, forma_pago_abono, creado_en from cuentas_por_cobrar order by creado_en, id")
rep = q(env, """select c.id cliente_id, r.cargo_id, r.pendiente
                from (select distinct cliente_id id from cuentas_por_cobrar) c, lateral public.cxc_reparto_cliente(c.id) r""")
cli = q(env, "select id, saldo_pendiente, saldo_a_favor from clientes where id in (select distinct cliente_id from cuentas_por_cobrar)")
json.dump({'movs': movs, 'reparto_sql': rep, 'clientes': cli}, open('../../../.tmp-op040/op057_comparacion.json', 'w'), default=str)
print(f'{env}: {len(movs)} movimientos, {len(cli)} clientes, {len(rep)} cargos repartidos por la base')
