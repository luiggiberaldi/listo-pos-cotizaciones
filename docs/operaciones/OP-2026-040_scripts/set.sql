with t as (select cliente_id, sum(case when tipo='cargo' then monto_usd else 0 end) cargos, sum(case when tipo='abono' then monto_usd else 0 end) abonos from cuentas_por_cobrar group by 1)
select c.id from clientes c left join t on t.cliente_id=c.id
where c.saldo_pendiente>0 or coalesce(t.abonos,0)>coalesce(t.cargos,0)+0.001
 or c.nombre ilike any(array['%angel pineda%','%punto amarillo%','%ali rafael vargas%','%carlos pacheco%','%albert omar%','%reykar%','%ew 2010%','%yahveh%','%kia 241%','%encendo%'])
