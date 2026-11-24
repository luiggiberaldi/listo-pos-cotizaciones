# OP-2026-042: prueba de la funcion de devolucion con los datos reales de Decoraciones Encendo.
# Todo ocurre dentro de un bloque que termina en error a proposito: la base deshace todo.
from lib import *

DESP = '169d962c-0e3f-4690-a300-2786825ce510'
CLI = '004f41a7-499c-436f-9216-ad415f04b075'
CRUCE = '50078f48-92f0-42dc-a07d-f856f0a36884'
DEV_ABONO = '1131e802-021d-4b7d-912f-50870df6e578'
DEV_CRED = 'ff084e20-b109-405b-a9f0-19f69e1174d0'

FOTO = f"""json_build_object(
  'saldo', (select saldo_pendiente::numeric(12,2) from clientes where id='{CLI}'),
  'favor', (select saldo_a_favor::numeric(12,2) from clientes where id='{CLI}'),
  'pagado_de_mas', coalesce((select pagado_de_mas_usd from v_cxc_pagado_de_mas where cliente_id='{CLI}'),0),
  'movs', (select json_agg(json_build_object('tipo',tipo,'monto',monto_usd::numeric(12,2),'forma',left(coalesce(forma_pago_abono,''),25)) order by creado_en) from cuentas_por_cobrar where cliente_id='{CLI}'))"""

sql = f"""do $D$
declare u uuid; antes json; ra json; rb json; fa json; fb json; err_a text; err_b text;
begin
  select id into u from usuarios where activo and rol in ('administracion','jefe','desarrollador')
    and cuenta_id=(select cuenta_id from notas_despacho where id='{DESP}') order by nombre limit 1;
  -- Volver al momento justo antes de la devolucion del 27-jul
  delete from cuentas_por_cobrar where id in ('{DEV_ABONO}','{DEV_CRED}');
  select {FOTO} into antes;

  -- Escenario A: nadie confirma nada -> la devolucion completa va a saldo a favor
  begin
    perform set_config('app.devolucion_destino','saldo_a_favor',true);
    perform set_config('app.devolucion_anular_abono','',true);
    ra := ajustar_finanzas_devolucion_atomica('{DESP}', 2148.30, 0, u, 'Prueba OP-042');
    select {FOTO} into fa;
    raise exception 'deshacer_a';
  exception when raise_exception then
    if sqlerrm <> 'deshacer_a' then err_a := sqlerrm; end if;
  end;

  -- Escenario B: el operador confirma que el Cruce era esta misma devolucion
  begin
    perform set_config('app.devolucion_destino','saldo_a_favor',true);
    perform set_config('app.devolucion_anular_abono','{CRUCE}',true);
    rb := ajustar_finanzas_devolucion_atomica('{DESP}', 2148.30, 0, u, 'Prueba OP-042');
    select {FOTO} into fb;
    raise exception 'deshacer_b';
  exception when raise_exception then
    if sqlerrm <> 'deshacer_b' then err_b := sqlerrm; end if;
  end;

  raise exception 'OP042RES%', json_build_object('antes',antes,'a',ra,'foto_a',fa,'err_a',err_a,'b',rb,'foto_b',fb,'err_b',err_b)::text;
end $D$;"""

try:
    q('staging', sql)
    print('ATENCION: no hubo excepcion')
except SystemExit as e:
    m = str(e)
    outer = json.loads(m[m.find('{'):])['message']
    if 'OP042RES' not in outer:
        raise SystemExit(outer)
    r, _ = json.JSONDecoder().raw_decode(outer[outer.find('OP042RES') + 8:])
    print(json.dumps(r, ensure_ascii=False, indent=1))
print('comprobacion, movimientos de Encendo siguen siendo 5:',
      q('staging', f"select count(*) from cuentas_por_cobrar where cliente_id='{CLI}'"))
