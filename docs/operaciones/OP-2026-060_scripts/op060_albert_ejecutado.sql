-- OP-2026-060 — EJECUTADO en producción el 2026-11-24 con orden del dueño ("este también tiene que quedar en 0 sin afectar reporte").
-- Albert Omar Ruiz Avila: resto de $60,59 del despacho #3262, pagado con el comprobante 261114 ("pago 2 deudas") el 29-sep.
-- Se anota con esa fecha, justo después del abono de $259,41 del mismo comprobante: el reporte de hoy no cambia.
-- Todo o nada: si el saldo no queda en $0, no se guarda nada. Deshacer: anular el movimiento desde la ficha, con motivo.
do $$
declare
  v_al uuid := '2137decd-6597-4aec-be79-be92d1d177d2';
  v_admin uuid := '3b492293-e2d1-4ed0-927d-510b7226dc15';  -- usuario ADMINISTRADOR (el que registra los abonos)
  v_cuenta uuid; v_s numeric;
begin
  if (select saldo_pendiente from clientes where id = v_al) <> 60.59 then raise exception 'LA DEUDA CAMBIÓ: no se hace nada'; end if;
  select cuenta_id into v_cuenta from cuentas_por_cobrar where despacho_id = '953fd62c-bba3-4d70-b167-9d2738f6c3cf' and tipo = 'cargo' limit 1;
  insert into cuentas_por_cobrar (cliente_id, despacho_id, cuenta_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, metodo_pago, creado_en, registrado_por)
  values (v_al, '953fd62c-bba3-4d70-b167-9d2738f6c3cf', v_cuenta, 'abono', 60.59, 0,
    '[{"metodo":"Transf. / Pago Móvil","monto":60.59,"referencia":"261114 (resto del comprobante, corrección OP-2026-060)"}]',
    '261114 (resto)', 'Resto despacho #3262, comprobante 261114 (corrección OP-2026-060)', 'cxc', '2026-09-29 15:50:00+00', v_admin);
  select saldo_pendiente into v_s from clientes where id = v_al;
  if v_s <> 0 then raise exception 'EL SALDO NO QUEDÓ EN 0 (%): no se guarda nada', v_s; end if;
  insert into auditoria (usuario_id, usuario_nombre, usuario_rol, categoria, accion, descripcion, entidad_tipo, entidad_id, meta)
  values (v_admin, 'Corrección OP-2026-060', 'administracion', 'FINANZAS', 'CORRECCION_PAGO_NO_REGISTRADO',
    'Resto de $60,59 del despacho #3262 (comprobante 261114) registrado con fecha 29-sep (orden del dueño, 2026-11-24)', 'cliente', v_al,
    jsonb_build_object('caso','OP-2026-060','monto',60.59,'forma_pago','Transf. / Pago Móvil','referencia','261114','fecha_real','2026-09-29','saldo_anterior',60.59,'saldo_nuevo',0,'autorizado_por','dueño'));
end $$;
