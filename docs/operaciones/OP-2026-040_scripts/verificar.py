from lib import *
import re
ids=json.load(open('ids.json')); CL=ids['clientes']
S=f"""select c.id, c.nombre, c.saldo_pendiente::numeric(12,2) sp, c.saldo_a_favor::numeric(12,2) sf,
 count(x.id) movs, coalesce(sum(x.monto_usd),0)::numeric(14,2) total,
 greatest(0,coalesce(sum(case when tipo='cargo' then monto_usd when tipo='abono' then -monto_usd end),0))::numeric(12,2) sp_calc,
 md5(coalesce(string_agg(x.id::text||x.tipo||x.monto_usd::text||coalesce(x.despacho_id::text,'')||coalesce(x.forma_pago_abono,'')||coalesce(x.referencia,''),'|' order by x.id),'')) huella
 from clientes c left join cuentas_por_cobrar x on x.cliente_id=c.id where c.id=any({arr(CL)}) group by c.id"""
p={r['id']:r for r in q('prod',S)}; s={r['id']:r for r in q('staging',S)}
dif=0
for k,r in p.items():
    t=s.get(k)
    for f in ('sp','sf','movs','total','huella'):
        if t is None or str(r[f])!=str(t[f]): dif+=1; print('DIFERENCIA',r['nombre'],f,r[f],t and t[f])
    if t and str(t['sp'])!=str(t['sp_calc']): dif+=1; print('SALDO NO CUADRA EN STAGING',t['nombre'],t['sp'],t['sp_calc'])
print('clientes comparados',len(p),'| diferencias',dif)
print('cartera de estos 41: prod',sum(float(r['sp']) for r in p.values()),'staging',sum(float(r['sp']) for r in s.values()))
D=ids['despachos']
H=f"select md5(string_agg(id::text||numero::text||estado||coalesce(total_usd::text,'')||coalesce(forma_pago,''),'|' order by id)) h, count(*) n from notas_despacho where id=any({arr(D)})"
try: print('despachos prod',q('prod',H),'staging',q('staging',H))
except SystemExit as e: print(e)
m=re.search(r"begin select (.*) into n;",open('copia.sql',encoding='utf-8').read(),re.S)
print('referencias rotas en staging:',q('staging','select '+m.group(1)+' n'))
print('Wendy:',q('staging',"select nombre, activo, pin_hash is null sin_pin from usuarios where id='c60ad041-05b4-4280-8705-f0636c625b6a'"))
