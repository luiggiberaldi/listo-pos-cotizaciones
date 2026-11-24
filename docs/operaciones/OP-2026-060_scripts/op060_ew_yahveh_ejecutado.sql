-- OP-2026-060 — EJECUTADO en producción el 2026-11-24 con orden del dueño:
--   "debe quedar en 0 al igual que Yahveh que pagó el viernes esa deuda que tiene por USDT".
-- 1) Constructora Ew 2010: Cruce de $850 del despacho #3347, con la fecha del despacho (21-sep).
-- 2) Inversiones y Suministro Yahveh: pago USDT de $313,43 del viernes 20-nov (después del abono 41PRV de las 4:28 p. m.).
-- Ninguno queda con fecha de hoy: el reporte de hoy no cambia. Todo o nada: si algún saldo no queda en $0, no se guarda nada.
-- Deshacer: anular esos 2 movimientos (descripción con "corrección OP-2026-060") desde la ficha, con motivo.
do $$
declare
  v_ew uuid := 'caf42772-64f8-40f0-a80b-5939ec041d46';
  v_ya uuid := 'c5f4c935-e409-4cf7-a553-fb8fb1fbe1db';
  v_admin uuid := '3b492293-e2d1-4ed0-927d-510b7226dc15';  -- usuario ADMINISTRADOR (el que registra los abonos)
  v_ew_cuenta uuid; v_ya_cuenta uuid; v_s1 numeric; v_s2 numeric;
begin
  if (select saldo_pendiente from clientes where id = v_ew) <> 850.00
     or (select saldo_pendiente from clientes where id = v_ya) <> 313.43 then
    raise exception 'ALGUNA DEUDA CAMBIÓ: no se hace nada';
  end if;
  select cuenta_id into v_ew_cuenta from cuentas_por_cobrar where despacho_id = '99606f6e-af01-46dc-926a-df89406566d9' and tipo = 'cargo' limit 1;
  select cuenta_id into v_ya_cuenta from cuentas_por_cobrar where id = 'dfef5c66-3532-4209-8ced-34ed3a9c7939';

  insert into cuentas_por_cobrar (cliente_id, despacho_id, cuenta_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, metodo_pago, creado_en, registrado_por)
  values
   (v_ew, '99606f6e-af01-46dc-926a-df89406566d9', v_ew_cuenta, 'abono', 850.00, 0,
    '[{"metodo":"Cruce","monto":850,"referencia":"Cruce autorizado por el dueño (corrección OP-2026-060)"}]',
    'Cruce autorizado por el dueño', 'Cruce despacho #3347 (corrección OP-2026-060)', 'cxc', '2026-09-21 18:30:00+00', v_admin),
   (v_ya, null, v_ya_cuenta, 'abono', 313.43, 0,
    '[{"metodo":"USDT","monto":313.43,"referencia":"Pago del viernes 20-nov (corrección OP-2026-060)"}]',
    'USDT 20-nov', 'ABONO A DEUDA — pago USDT del viernes (corrección OP-2026-060)', 'cxc', '2026-11-20 20:30:00+00', v_admin);

  select saldo_pendiente into v_s1 from clientes where id = v_ew;
  select saldo_pendiente into v_s2 from clientes where id = v_ya;
  if v_s1 <> 0 or v_s2 <> 0 then
    raise exception 'LOS SALDOS NO QUEDARON EN 0 (Ew %, Yahveh %): no se guarda nada', v_s1, v_s2;
  end if;

  insert into auditoria (usuario_id, usuario_nombre, usuario_rol, categoria, accion, descripcion, entidad_tipo, entidad_id, meta)
  values
   (v_admin, 'Corrección OP-2026-060', 'administracion', 'FINANZAS', 'CORRECCION_PAGO_NO_REGISTRADO',
    'Cruce de $850 del despacho #3347 registrado con fecha 21-sep (orden del dueño, 2026-11-24)', 'cliente', v_ew,
    jsonb_build_object('caso','OP-2026-060','monto',850,'forma_pago','Cruce','fecha_real','2026-09-21','saldo_anterior',850,'saldo_nuevo',0,'autorizado_por','dueño')),
   (v_admin, 'Corrección OP-2026-060', 'administracion', 'FINANZAS', 'CORRECCION_PAGO_NO_REGISTRADO',
    'Pago USDT de $313,43 del viernes 20-nov registrado con su fecha real (orden del dueño, 2026-11-24)', 'cliente', v_ya,
    jsonb_build_object('caso','OP-2026-060','monto',313.43,'forma_pago','USDT','fecha_real','2026-11-20','saldo_anterior',313.43,'saldo_nuevo',0,'autorizado_por','dueño'));
end $$;
