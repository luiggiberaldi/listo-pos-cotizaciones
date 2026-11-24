-- OP-2026-060 — EJECUTADO en producción el 2026-11-24 con orden del dueño ("igual este": dejar en 0 sin afectar el reporte).
-- KIA 241: diferencia de $64,50 del intercambio del despacho #3596, del 02-oct. Método no informado: se usa el mismo del
-- resto del despacho (Transf. / Pago Móvil); si fue otro, se corrige anulando y registrando de nuevo con esa misma fecha.
-- Todo o nada: si el saldo no queda en $0, no se guarda nada.
do $$
declare
  v_k uuid := 'c3b76f18-39de-4abe-afc2-6955c1dc2f37';
  v_admin uuid := '3b492293-e2d1-4ed0-927d-510b7226dc15';  -- usuario ADMINISTRADOR (el que registra los abonos)
  v_cuenta uuid; v_s numeric;
begin
  if (select saldo_pendiente from clientes where id = v_k) <> 64.50 then raise exception 'LA DEUDA CAMBIÓ: no se hace nada'; end if;
  select cuenta_id into v_cuenta from cuentas_por_cobrar where despacho_id = '69436d71-248f-4736-a81e-c57784edc2cf' and tipo = 'cargo' limit 1;
  insert into cuentas_por_cobrar (cliente_id, despacho_id, cuenta_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, metodo_pago, creado_en, registrado_por)
  values (v_k, '69436d71-248f-4736-a81e-c57784edc2cf', v_cuenta, 'abono', 64.50, 0,
    '[{"metodo":"Transf. / Pago Móvil","monto":64.5,"referencia":"Diferencia intercambio #3596 (corrección OP-2026-060)"}]',
    'Diferencia intercambio #3596', 'Cobro de diferencia en intercambio — Despacho #3596 (corrección OP-2026-060)', 'cxc', '2026-10-02 16:25:00+00', v_admin);
  select saldo_pendiente into v_s from clientes where id = v_k;
  if v_s <> 0 then raise exception 'EL SALDO NO QUEDÓ EN 0 (%): no se guarda nada', v_s; end if;
  insert into auditoria (usuario_id, usuario_nombre, usuario_rol, categoria, accion, descripcion, entidad_tipo, entidad_id, meta)
  values (v_admin, 'Corrección OP-2026-060', 'administracion', 'FINANZAS', 'CORRECCION_PAGO_NO_REGISTRADO',
    'Diferencia de $64,50 del intercambio del despacho #3596 registrada con fecha 02-oct (orden del dueño, 2026-11-24)', 'cliente', v_k,
    jsonb_build_object('caso','OP-2026-060','monto',64.5,'forma_pago','Transf. / Pago Móvil','metodo_supuesto',true,'fecha_real','2026-10-02','saldo_anterior',64.5,'saldo_nuevo',0,'autorizado_por','dueño'));
end $$;
