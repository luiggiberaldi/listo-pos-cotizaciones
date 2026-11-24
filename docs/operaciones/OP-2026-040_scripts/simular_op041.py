# OP-2026-041: simula en staging las correcciones de los casos de CxC y las DESHACE al final.
# El resultado vuelve dentro de un error a proposito: asi la base garantiza que no queda nada aplicado.
from lib import *

ADMIN = "(select registrado_por from cuentas_por_cobrar x join clientes c on c.id=x.cliente_id where c.nombre ilike 'Decoraciones Encendo%' limit 1)"


def cli(patron):
    return f"(select id from clientes where nombre ilike '{patron}' limit 1)"


AFECT = ['Decoraciones Encendo%', 'CARLOS ESCALONA', 'Ferrechuros 2025', 'JONNY  Espinoza', 'Jesus Daniel Chirinos Camacho',
         'Ernesto Daniel Castilla Alastre', 'Georgina Gomez', 'Leidy Contreras', 'H%ctor Jordan', 'FERRETERIA EL GRAN ADONAY',
         'Dayimar Mercado', 'Manuel Veliz', 'Anthony Ruiz', 'ALBERT OMAR RUIZ AVILA', 'KIA 241, C.A', 'Constructora Ew 2010,c,a',
         'INVERSIONES Y SUMINISTRO YAHVEH, C.A', 'ADALBERTO ROJAS', 'A_40, C.A', 'Beatriz Landadeta', 'REYKAR A.S.E , C.A']
lista = ",".join(f"'{p}'" for p in AFECT)

FOTO = f"""(select json_agg(json_build_object('n',c.nombre,'sp',c.saldo_pendiente::numeric(12,2),'sf',c.saldo_a_favor::numeric(12,2),
  'exceso',greatest(0,coalesce((select sum(case when tipo='abono' then monto_usd when tipo='cargo' then -monto_usd else 0 end)
     from cuentas_por_cobrar x where x.cliente_id=c.id),0))::numeric(12,2)) order by c.nombre)
  from clientes c where c.nombre ilike any(array[{lista}]))"""
TOT = """json_build_object('cartera',(select sum(saldo_pendiente)::numeric(12,2) from clientes),
  'exceso_total',(select sum(e)::numeric(12,2) from (select greatest(0,sum(case when tipo='abono' then monto_usd when tipo='cargo' then -monto_usd else 0 end)) e from cuentas_por_cobrar group by cliente_id) z))"""


def abono(patron, monto, forma, ref, desc):
    return (f"insert into cuentas_por_cobrar (cliente_id,tipo,monto_usd,saldo_usd,forma_pago_abono,referencia,descripcion,registrado_por,cuenta_id) "
            f"select {cli(patron)},'abono',{monto},0,'{forma}','{ref}','{desc}',{ADMIN},(select cuenta_id from clientes where id={cli(patron)});")


pasos = [
    # 1. Decoraciones Encendo: se quita el "Cruce - NO PROCEDE" (la devolucion ya cubrio el credito de #1863)
    f"delete from cuentas_por_cobrar where cliente_id={cli('Decoraciones Encendo%')} and tipo='abono' and referencia='NO PROCEDE' and monto_usd=2144;",
    # 2. Carlos Escalona: se quita el abono de $356 (ya esta dentro del efectivo de #533)
    f"delete from cuentas_por_cobrar where cliente_id={cli('CARLOS ESCALONA')} and tipo='abono' and monto_usd=356;",
    # 3. Registros viejos de pago con saldo a favor: se pasan al tipo correcto (consumo_credito), como manda la correccion de agosto
    "update cuentas_por_cobrar set tipo='consumo_credito' where tipo='abono' and forma_pago_abono='Saldo a favor' and descripcion ilike 'Pago con Saldo a Favor%';",
    # 4. Los 4 pagos de OP-2026-039, tal como los registraria administracion
    abono('ALBERT OMAR RUIZ AVILA', 60.59, 'Transf. / Pago Movil', '261114 (diferencia)', 'SIMULACION OP-041 PAGO FACT 3262'),
    abono('KIA 241, C.A', 64.50, 'Efectivo', 'SIMULACION', 'SIMULACION OP-041 DIFERENCIA INTERCAMBIO 3596'),
    abono('Constructora Ew 2010,c,a', 850, 'Cruce', 'SIMULACION', 'SIMULACION OP-041 CRUCE FACT 3347'),
    abono('INVERSIONES Y SUMINISTRO YAHVEH, C.A', 313.43, 'Transf. / Pago Movil', 'SIMULACION', 'SIMULACION OP-041 RESTO FACT 4804'),
]
sql = f"""do $D$ declare antes json; despues json; ta json; td json; begin
 select {FOTO}, {TOT} into antes, ta;
 {' '.join(pasos)}
 select {FOTO}, {TOT} into despues, td;
 raise exception 'OP041RES%', json_build_object('antes',antes,'despues',despues,'tot_antes',ta,'tot_despues',td)::text;
end $D$;"""
try:
    q('staging', sql)
    print('ATENCION: no hubo excepcion (no deberia pasar)')
except SystemExit as e:
    m = str(e)
    i = m.find('OP041RES')
    if i < 0:
        raise
    outer = json.loads(m[m.find('{'):])['message']
    raw = outer[outer.find('OP041RES') + 8:]
    r, _ = json.JSONDecoder().raw_decode(raw)
    json.dump(r, open('simulacion.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    a = {x['n']: x for x in r['antes']}
    for x in r['despues']:
        y = a[x['n']]
        print(f"{x['n'][:38]:38s} deuda {y['sp']:>9} -> {x['sp']:>9} | a favor {y['sf']:>6} -> {x['sf']:>6} | oculto {y['exceso']:>8} -> {x['exceso']:>8}")
    print('totales antes', r['tot_antes'], '\ntotales despues', r['tot_despues'])
print('comprobacion: filas SIMULACION que quedaron en staging =',
      q('staging', "select count(*) from cuentas_por_cobrar where descripcion like 'SIMULACION OP-041%'"))
