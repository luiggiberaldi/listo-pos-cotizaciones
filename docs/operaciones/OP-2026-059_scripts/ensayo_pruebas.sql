-- OP-2026-059 — Pruebas funcionales de las migraciones de PRODUCCIÓN 301-309, ejecutadas sobre STAGING
-- dentro de la transacción de ensayo_staging.py (todo se deshace al final con ROLLBACK).
-- Al terminar se lanza un error a propósito con el resumen, para que nada quede guardado y el
-- resultado llegue de vuelta. Datos: despachos y clientes reales de staging (copia de OP-2026-040).

create temp table _res (n serial, paso text, ok boolean, detalle text) on commit drop;

-- T1 (G1 + anular abono, como Encendo): devolución de $100 en #3283 con un Cruce suelto de $100 que el
-- operador confirma que era la misma devolución. Se usa la función de PRODUCCIÓN ajustar_finanzas_devolucion_neta.
do $$
declare d uuid := '7dc9a7f2-0235-4783-b7d1-63ddef35f954'; cli uuid := '149687ba-3535-4240-91b5-39f550e9f514';
        usr uuid := '3b492293-e2d1-4ed0-927d-510b7226dc15'; a uuid; r jsonb; n_arch int; n_dev int;
begin
  insert into cuentas_por_cobrar (cliente_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, registrado_por)
  values (cli, 'abono', 100, 0, 'Cruce', 'ensayo', 'Cruce de prueba', usr) returning id into a;
  update notas_despacho set total_usd = total_usd - 100 where id = d;
  perform set_config('app.devolucion_destino', 'saldo_a_favor', true);
  perform set_config('app.devolucion_anular_abono', a::text, true);
  r := ajustar_finanzas_devolucion_neta(d, 100, 0, usr, 'Ensayo OP-059');
  select count(*) into n_arch from cxc_movimientos_borrados where movimiento_id = a;
  select count(*) into n_dev from cuentas_por_cobrar where despacho_id = d and tipo = 'abono' and forma_pago_abono = 'Devolución';
  insert into _res (paso, ok, detalle) values ('T1 anular abono en devolución (_neta producción)',
    (r->'abono_anulado'->>'id')::uuid = a and not exists (select 1 from cuentas_por_cobrar where id = a) and n_arch = 1 and n_dev = 1,
    format('abono_anulado=%s archivado=%s abono_devolucion=%s abono_monto=%s', r->'abono_anulado'->>'monto_usd', n_arch, n_dev, r->>'abono_monto'));
  perform set_config('app.devolucion_anular_abono', '', true);
exception when others then insert into _res (paso, ok, detalle) values ('T1', false, sqlerrm);
end $$;

-- T2 (G1): #1678 con deuda $576 ya cubierta por un pago suelto de $576; devolución de $100 → debe ir a
-- saldo a favor (antes, producción la descontaba de una deuda ya pagada).
do $$
declare d uuid := '3b193fb5-70d5-445e-97d5-44c708ff8ceb'; cli uuid := '5eb474f9-cf98-470f-8cc3-f535fd088554';
        usr uuid := '3b492293-e2d1-4ed0-927d-510b7226dc15'; r jsonb;
begin
  insert into cuentas_por_cobrar (cliente_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, registrado_por)
  values (cli, 'abono', 576, 0, 'Zelle', 'ensayo', 'Pago suelto de prueba', usr);
  update notas_despacho set total_usd = total_usd - 100 where id = d;
  perform set_config('app.devolucion_destino', 'saldo_a_favor', true);
  r := ajustar_finanzas_devolucion_neta(d, 100, 0, usr, 'Ensayo OP-059');
  insert into _res (paso, ok, detalle) values ('T2 devolución con deuda ya pagada va a saldo a favor',
    (r->>'abono_monto')::numeric = 0 and (r->>'credito_monto')::numeric = 100, format('abono=%s credito=%s', r->>'abono_monto', r->>'credito_monto'));
exception when others then insert into _res (paso, ok, detalle) values ('T2', false, sqlerrm);
end $$;

-- T3 (G2): reabrir #4203 (entregada) con un abono Zelle de $50 enlazado. Sin decisión debe negarse;
-- con 'saldo_favor' debe reabrir, no borrar el pago (pasa a saldo a favor) y anotar en auditoría.
do $$
declare d uuid := 'df33498a-a314-4d6b-be74-6fe5de2c5411'; cli uuid := '950fbffe-f57d-4fe7-b291-78af11a65b3d';
        usr uuid := '3b492293-e2d1-4ed0-927d-510b7226dc15'; a uuid; j jsonb; r jsonb; sin_decision text := 'no falló';
begin
  insert into cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, registrado_por)
  values (cli, d, 'abono', 50, 306, 'Zelle', 'ensayo', 'Abono de prueba', usr) returning id into a;
  j := cxc_pagos_en_juego_despacho(d);
  begin
    perform reabrir_despacho_con_pagos(d, 'pendiente', usr, 'Ensayo', 'administracion', null, gen_random_uuid(), null, 'prueba');
  exception when others then sin_decision := sqlerrm;
  end;
  r := reabrir_despacho_con_pagos(d, 'pendiente', usr, 'Ensayo', 'administracion', null, gen_random_uuid(), 'saldo_favor', 'prueba ensayo');
  insert into _res (paso, ok, detalle) values ('T3 reabrir con pagos (usa revertir_entrega_finanzas_idempotente)',
    (j->>'requiere_decision_reabrir')::boolean and sin_decision like '%DECISION_PAGOS_REQUERIDA%'
      and (select estado from notas_despacho where id = d) = 'pendiente'
      and exists (select 1 from cuentas_por_cobrar where id = a and tipo = 'credito' and despacho_id is null)
      and exists (select 1 from auditoria where accion = 'REABRIR_DESPACHO_PAGOS' and entidad_id = d),
    format('sin_decision=%s pasado_a_saldo_favor=%s', left(sin_decision, 40), r->'pagos'->>'pasado_a_saldo_favor'));
exception when others then insert into _res (paso, ok, detalle) values ('T3', false, sqlerrm);
end $$;

-- T4 (I2/G4/N8/I3): abono atómico, repetición con la misma clave, aviso de posible duplicado y anulación con motivo
do $$
declare cli uuid := 'b5e0be92-f5da-4b30-b250-e40695f1e198'; usr uuid := '3b492293-e2d1-4ed0-927d-510b7226dc15';
        cta uuid; r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb; demas text := 'no falló';
begin
  select cuenta_id into cta from clientes where id = cli;
  r1 := cxc_registrar_abono_atomico(cli, 5, 'Zelle', 'ref-ensayo', 'Abono ensayo', null, usr, 'Ensayo', 'administracion', 'clave-ensayo-059');
  r2 := cxc_registrar_abono_atomico(cli, 5, 'Zelle', 'ref-ensayo', 'Abono ensayo', null, usr, 'Ensayo', 'administracion', 'clave-ensayo-059');
  r3 := cxc_registrar_abono_atomico(cli, 1, 'Zelle', 'ref-ensayo', 'Abono ensayo', null, usr, 'Ensayo', 'administracion', 'clave-ensayo-059b');
  r3 := cxc_registrar_abono_atomico(cli, 1, 'Zelle', 'ref-ensayo', 'Abono ensayo', null, usr, 'Ensayo', 'administracion', 'clave-ensayo-059c');
  begin
    perform cxc_registrar_abono_atomico(cli, 500, 'Zelle', 'x', 'x', null, usr, 'Ensayo', 'administracion', 'clave-ensayo-059d');
  exception when others then demas := sqlerrm;
  end;
  r4 := cxc_anular_movimiento((r1->>'id')::uuid, cta, usr, 'Ensayo', 'administracion', 'Motivo de prueba del ensayo OP-059');
  insert into _res (paso, ok, detalle) values ('T4 abono atómico + clave + duplicado + monto + anular',
    (r2->>'idempotent')::boolean and (r2->>'id') = (r1->>'id') and r3 ? 'posible_duplicado'
      and demas like '%MONTO_SUPERA_SALDO%'
      and exists (select 1 from cxc_movimientos_borrados where movimiento_id = (r1->>'id')::uuid and motivo like 'Motivo de prueba%' and origen = 'anular_movimiento')
      and exists (select 1 from auditoria where accion = 'REGISTRAR_ABONO' and meta->>'abono_id' = r1->>'id'),
    format('r1=%s r2.idempotent=%s r3=%s demas=%s', r1->>'monto', r2->>'idempotent', left(r3::text, 30), left(demas, 30)));
exception when others then insert into _res (paso, ok, detalle) values ('T4', false, sqlerrm);
end $$;

-- T5 (N15): saldo a favor en un solo paso: cargar $10, devolver $4, cruzar $3 contra la deuda
do $$
declare cli uuid := '3410908c-d655-4ab7-95ac-41920e500d1b'; usr uuid := '3b492293-e2d1-4ed0-927d-510b7226dc15';
        r1 jsonb; r2 jsonb; r3 jsonb;
begin
  r1 := cxc_saldo_favor_atomico('credito', cli, 10, 'Efectivo $', 'ens', 'Carga ensayo', usr, 'Ensayo', 'administracion', 'sf-059-1');
  r2 := cxc_saldo_favor_atomico('devolucion_credito', cli, 4, 'Efectivo $', 'ens', 'Devolución ensayo', usr, 'Ensayo', 'administracion', 'sf-059-2');
  r3 := cxc_saldo_favor_atomico('cruce', cli, 3, null, null, null, usr, 'Ensayo', 'administracion', 'sf-059-3');
  insert into _res (paso, ok, detalle) values ('T5 saldo a favor atómico',
    (r3->>'nuevo_saldo_favor')::numeric = (r1->>'nuevo_saldo_favor')::numeric - 7,
    format('favor tras carga=%s tras devolución=%s tras cruce=%s', r1->>'nuevo_saldo_favor', r2->>'nuevo_saldo_favor', r3->>'nuevo_saldo_favor'));
exception when others then insert into _res (paso, ok, detalle) values ('T5', false, sqlerrm);
end $$;

-- T6 (N1): anular un pendiente con $9,98 en efectivo anotado, pasándolo a saldo a favor
do $$
declare d uuid := '4d85d7f0-ea3b-43b3-9eb4-5f9452ecbb74'; usr uuid := '3b492293-e2d1-4ed0-927d-510b7226dc15'; r jsonb;
begin
  r := anular_despacho_con_pagos(d, usr, 'Ensayo', 'administracion', 'saldo_favor', 'Motivo de anulación de prueba');
  insert into _res (paso, ok, detalle) values ('T6 anular con pagos anotados',
    (select estado from notas_despacho where id = d) = 'anulada' and (r->>'creditos_creados')::int = 1,
    r::text);
exception when others then insert into _res (paso, ok, detalle) values ('T6', false, sqlerrm);
end $$;

-- T7: las funciones envoltorio encuentran a la función de siempre (no "function does not exist")
do $$
declare e1 text := 'sin error'; e2 text := 'sin error';
begin
  begin
    perform devolucion_con_donacion(gen_random_uuid(), gen_random_uuid(), null, '[]'::jsonb, '[]'::jsonb, 'x',
      gen_random_uuid(), 'x', null, 0, 0, null, null, 'saldo_a_favor', null, null, 'administracion', 0, 0, 0.5, false, null);
  exception when others then e1 := sqlerrm;
  end;
  begin
    perform editar_despacho_profundidad_con_cxc('9bd8daf2-ed54-4b86-9f5c-1766142e5857', '[]'::jsonb, '3b492293-e2d1-4ed0-927d-510b7226dc15', 'Ensayo', 'administracion', null, null);
  exception when others then e2 := sqlerrm;
  end;
  insert into _res (paso, ok, detalle) values ('T7 envoltorios llaman a las funciones de producción',
    e1 like '%IDEMPOTENCY_KEY_OBLIGATORIA%' and e2 not like '%does not exist%', format('donacion=%s | edicion=%s', left(e1, 60), left(e2, 80)));
end $$;

-- T8 (M3): reparto con dos deudas en el mismo despacho (cxc y cod): el abono cod paga primero el cargo cod
do $$
declare cli uuid := '149687ba-3535-4240-91b5-39f550e9f514'; d uuid := '7dc9a7f2-0235-4783-b7d1-63ddef35f954';
        usr uuid := '3b492293-e2d1-4ed0-927d-510b7226dc15'; pend numeric;
begin
  insert into cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, descripcion, registrado_por, metodo_pago)
  values (cli, d, 'cargo', 40, 40, 'cargo cod ensayo', usr, 'cod');
  insert into cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, forma_pago_abono, descripcion, registrado_por, metodo_pago)
  values (cli, d, 'abono', 40, 0, 'Efectivo $', 'abono cod ensayo', usr, 'cod');
  select pendiente into pend from cxc_reparto_cliente(cli) r where r.monto = 40 and r.despacho_id = d;
  insert into _res (paso, ok, detalle) values ('T8 reparto dos deudas', pend = 0, format('pendiente cargo cod=%s', pend));
exception when others then insert into _res (paso, ok, detalle) values ('T8', false, sqlerrm);
end $$;

do $$ begin
  raise exception 'RESULTADOS_ENSAYO %', (select json_agg(json_build_object('paso', paso, 'ok', ok, 'detalle', detalle) order by n) from _res);
end $$;
