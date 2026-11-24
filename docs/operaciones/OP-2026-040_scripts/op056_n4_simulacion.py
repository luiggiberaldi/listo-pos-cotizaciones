# OP-2026-056 (N4) — Simulación SOLO LECTURA en producción de la corrección de los registros viejos
# "Pago con Saldo a Favor…" guardados como ABONO (deberían ser "consumo de saldo a favor").
# No cambia nada: calcula, para cada cliente afectado, cómo quedarían deuda, saldo a favor y "pagado de más".
# La corrección real está en op056_n4_correccion.sql y necesita aprobación explícita para producción.
import sys, json
from lib import q

env = sys.argv[1] if len(sys.argv) > 1 else 'prod'
FILTRO = "tipo = 'abono' and forma_pago_abono = 'Saldo a favor' and descripcion ilike 'Pago con Saldo a Favor%'"

filas = q(env, f"select id, cliente_id, despacho_id, monto_usd, descripcion, creado_en::date fecha from cuentas_por_cobrar where {FILTRO} order by creado_en")
print(f'== {env}: registros a corregir: {len(filas)}, total ${sum(float(f["monto_usd"]) for f in filas):.2f}')

sql = f"""
with afectados as (select distinct cliente_id from cuentas_por_cobrar where {FILTRO}),
base as (
  select c.cliente_id,
    sum(case when c.tipo='cargo' then c.monto_usd else 0 end) cargos,
    sum(case when c.tipo='abono' then c.monto_usd else 0 end) abonos,
    sum(case when c.tipo='abono' and {FILTRO.replace('tipo', 'c.tipo').replace('forma_pago_abono', 'c.forma_pago_abono').replace('descripcion', 'c.descripcion')} then c.monto_usd else 0 end) a_corregir,
    sum(case when c.tipo='credito' then c.monto_usd
             when c.tipo='abono' and c.forma_pago_abono='Saldo a favor' then -c.monto_usd
             when c.tipo in ('devolucion_credito','consumo_credito') then -c.monto_usd else 0 end) favor
  from cuentas_por_cobrar c join afectados a on a.cliente_id = c.cliente_id
  group by c.cliente_id
)
select k.nombre, round(b.a_corregir,2) a_corregir,
  round(greatest(0, b.cargos - b.abonos),2) deuda_hoy,
  round(greatest(0, b.cargos - (b.abonos - b.a_corregir)),2) deuda_despues,
  round(greatest(0, b.abonos - b.cargos),2) pagado_de_mas_hoy,
  round(greatest(0, (b.abonos - b.a_corregir) - b.cargos),2) pagado_de_mas_despues,
  round(greatest(0, b.favor),2) saldo_favor_hoy_y_despues
from base b join clientes k on k.id = b.cliente_id
order by b.a_corregir desc
"""
res = q(env, sql)
for r in res:
    print(json.dumps(r, ensure_ascii=False, default=str))
cambian = [r for r in res if r['deuda_hoy'] != r['deuda_despues']]
print(f'\nClientes: {len(res)}; deuda que cambia: {len(cambian)}; pagado de más total hoy ${sum(float(r["pagado_de_mas_hoy"]) for r in res):.2f} -> después ${sum(float(r["pagado_de_mas_despues"]) for r in res):.2f}')
