# OP-2026-046: comprobaciones de abonos en producción (solo lectura)
import json, sys
sys.path.insert(0, '.')
from lib import q

def show(t, sql, n=40):
    r = q('prod', sql)
    print(f'\n## {t}: {len(r)}')
    for x in r[:n]: print('  ', json.dumps(x, default=str, ensure_ascii=False)[:330])
    return r

show('Resumen de abonos', "select count(*) total, min(creado_en)::date desde, sum(monto_usd) suma, count(*) filter (where despacho_id is null) sin_despacho from cuentas_por_cobrar where tipo='abono'")
show('1. Clientes cuyo saldo guardado no coincide con cargos - abonos', """
select cl.nombre, cl.codigo_cliente, cl.saldo_pendiente, round(greatest(0, coalesce(sum(c.monto_usd) filter (where tipo='cargo'),0) - coalesce(sum(c.monto_usd) filter (where tipo='abono'),0)),2) calculado
from clientes cl left join cuentas_por_cobrar c on c.cliente_id=cl.id group by cl.id
having abs(cl.saldo_pendiente - greatest(0, coalesce(sum(c.monto_usd) filter (where tipo='cargo'),0) - coalesce(sum(c.monto_usd) filter (where tipo='abono'),0))) > 0.01""")
show('2. Abonos con monto cero o negativo', "select id, monto_usd, creado_en from cuentas_por_cobrar where tipo='abono' and monto_usd <= 0")
show('3. Abonos cuyo detalle de pago no suma el monto', """
select c.creado_en::date, cl.nombre, c.monto_usd, c.forma_pago_abono from cuentas_por_cobrar c join clientes cl on cl.id=c.cliente_id
where c.tipo='abono' and c.forma_pago_abono ~ '^\\s*\\[' and abs((select coalesce(sum((e->>'monto')::numeric),0) from jsonb_array_elements(c.forma_pago_abono::jsonb) e) - c.monto_usd) > 0.01""")
show('4. Abonos enlazados a un despacho de OTRO cliente', """
select c.creado_en::date, cl.nombre cliente_abono, c.monto_usd, n.numero, cl2.nombre cliente_despacho from cuentas_por_cobrar c
join notas_despacho n on n.id=c.despacho_id join clientes cl on cl.id=c.cliente_id join clientes cl2 on cl2.id=n.cliente_id
where c.tipo='abono' and n.cliente_id<>c.cliente_id and coalesce(n.cliente_factura_id, n.cliente_id)<>c.cliente_id""")
show('5. Abonos enlazados a despachos anulados', """
select c.creado_en::date, cl.nombre, c.monto_usd, n.numero, n.estado from cuentas_por_cobrar c join notas_despacho n on n.id=c.despacho_id join clientes cl on cl.id=c.cliente_id
where c.tipo='abono' and n.estado not in ('despachada','entregada')""")
show('6. Posibles duplicados: mismo cliente y monto en menos de 10 minutos', """
select cl.nombre, a.monto_usd, a.creado_en a_fecha, b.creado_en b_fecha, a.referencia ref_a, b.referencia ref_b, a.descripcion
from cuentas_por_cobrar a join cuentas_por_cobrar b on b.cliente_id=a.cliente_id and b.tipo='abono' and b.monto_usd=a.monto_usd and b.id>a.id
 and abs(extract(epoch from b.creado_en-a.creado_en))<600 join clientes cl on cl.id=a.cliente_id
where a.tipo='abono' and coalesce(nullif(trim(a.referencia),''),'x')=coalesce(nullif(trim(b.referencia),''),'x') order by a.creado_en""")
show('7. Misma referencia (>=4 letras) y monto en clientes distintos', """
select upper(trim(a.referencia)) ref, a.monto_usd, cl.nombre, cl2.nombre otro, a.creado_en::date, b.creado_en::date
from cuentas_por_cobrar a join cuentas_por_cobrar b on b.tipo='abono' and b.id>a.id and b.cliente_id<>a.cliente_id and b.monto_usd=a.monto_usd and upper(trim(b.referencia))=upper(trim(a.referencia))
join clientes cl on cl.id=a.cliente_id join clientes cl2 on cl2.id=b.cliente_id
where a.tipo='abono' and length(trim(a.referencia))>=4 and trim(a.referencia) !~* '^(enzo|gaby|efectivo|pago|zelle|usdt|varios|a enzo|a gaby|pago a enzo|pago a gaby|confirmo enzo|enzo confirmo)\\s*$'""")
show('8. Abonos mayores que la deuda que había (dejan pagado de más)', """
with m as (select c.*, sum(case when tipo='cargo' then monto_usd when tipo='abono' then -monto_usd else 0 end) over (partition by cliente_id order by creado_en, id) acum from cuentas_por_cobrar c where tipo in ('cargo','abono'))
select cl.nombre, m.creado_en::date, m.monto_usd, round(m.acum,2) saldo_tras_abono, m.descripcion from m join clientes cl on cl.id=m.cliente_id where m.tipo='abono' and m.acum < -0.02 order by m.creado_en""")
show('9. Desde el 23-oct: abonos sin registro en auditoria', """
select c.creado_en, cl.nombre, c.monto_usd, c.descripcion, c.metodo_pago from cuentas_por_cobrar c join clientes cl on cl.id=c.cliente_id
where c.tipo='abono' and c.creado_en >= '2026-10-24' and c.descripcion not ilike 'Abono por devoluci%' and c.descripcion not ilike 'COD Despacho%'
and not exists (select 1 from auditoria a where a.accion='REGISTRAR_ABONO' and a.entidad_id=c.cliente_id and abs((a.meta->>'monto')::numeric - c.monto_usd)<0.01 and abs(extract(epoch from a.ts-c.creado_en))<120)""")
show('10. Desde el 23-oct: abonos en auditoria que ya no existen (revertidos o borrados)', """
select a.ts, a.usuario_nombre, a.meta->>'monto' monto, cl.nombre,
 exists (select 1 from auditoria r where r.accion='REVERTIR_ABONO' and r.entidad_id=a.entidad_id and r.ts>a.ts) hay_reversion
from auditoria a left join clientes cl on cl.id=a.entidad_id
where a.accion='REGISTRAR_ABONO' and not exists (select 1 from cuentas_por_cobrar c where c.tipo='abono' and c.cliente_id=a.entidad_id and abs(c.monto_usd-(a.meta->>'monto')::numeric)<0.01 and abs(extract(epoch from a.ts-c.creado_en))<120)""")
show('11. Reversiones de abonos', "select ts, usuario_nombre, descripcion, meta from auditoria where accion='REVERTIR_ABONO' order by ts")
