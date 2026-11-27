-- OP-2026-063 — EJECUTADO en producción el 2026-11-24 con orden del dueño. CONSTRUACERO LOS GUAYOS C.A. (#155297, J-50824330-7): dejar la deuda en $0.
-- Orden del dueño (2026-11-24): "dejalo en 0, ya no tiene deuda, sin afectar los reportes de hoy".
-- Respuestas del dueño: pagó los $1.345,50 completos, sin dinero, con fecha 18-nov (día del despacho #4800).
--   => Se anota como Cruce autorizado por el dueño (como Constructora Ew en OP-2026-060). NO es cobro en dinero.
-- Dos abonos, cada uno en su despacho, con fecha 18-nov 2:30 p. m. (después del cargo de las 2:20 p. m.):
--   $1.345,00 → cargo por diferencia en intercambio, despacho #4800
--   $0,50     → resto de la factura #679 (céntimos que quedaron del Cruce de $1.233 del 28-jul)
-- El saldo a favor de $450 (excedente del intercambio #4211) NO se toca.
-- Ninguno queda con fecha de hoy: el reporte de hoy no cambia. Sin comisiones en esos despachos.
-- Todo o nada: si la deuda ya cambió, o si el saldo no queda en $0, o si el saldo a favor cambia, no se guarda nada.
-- Deshacer: anular esos 2 movimientos (descripción con "corrección OP-2026-063") desde la ficha, con motivo.
do $$
declare
  v_cli uuid := 'af748c54-c8cb-44b4-aae4-771463e54dc2';
  v_admin uuid := '3b492293-e2d1-4ed0-927d-510b7226dc15';  -- usuario ADMINISTRADOR (el que registra los abonos)
  v_cuenta uuid := '74dd6821-963d-406e-8621-47352e0df27e';
  v_saldo numeric; v_favor numeric;
begin
  if (select saldo_pendiente from clientes where id = v_cli) <> 1345.50
     or (select saldo_a_favor from clientes where id = v_cli) <> 450.00 then
    raise exception 'LA DEUDA O EL SALDO A FAVOR CAMBIÓ: no se hace nada';
  end if;

  insert into cuentas_por_cobrar (cliente_id, despacho_id, cuenta_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, metodo_pago, creado_en, registrado_por)
  values
   (v_cli, 'f42f3739-2c4e-400b-9b13-bf3c8b20ea42', v_cuenta, 'abono', 1345.00, 0,
    '[{"metodo":"Cruce","monto":1345,"referencia":"Cruce autorizado por el dueño (corrección OP-2026-063)"}]',
    'Cruce autorizado por el dueño', 'Cruce despacho #4800 (corrección OP-2026-063)', 'cxc', '2026-11-18 18:30:00+00', v_admin),
   (v_cli, '29709cf1-b100-4456-a5c2-2116fc908b48', v_cuenta, 'abono', 0.50, 0,
    '[{"metodo":"Cruce","monto":0.5,"referencia":"Céntimos de la factura #679 (corrección OP-2026-063)"}]',
    'Cruce autorizado por el dueño', 'Cruce céntimos despacho #679 (corrección OP-2026-063)', 'cxc', '2026-11-18 18:30:01+00', v_admin);

  select saldo_pendiente, saldo_a_favor into v_saldo, v_favor from clientes where id = v_cli;
  if v_saldo <> 0 or v_favor <> 450.00 then
    raise exception 'RESULTADO INESPERADO (deuda %, saldo a favor %): no se guarda nada', v_saldo, v_favor;
  end if;

  insert into auditoria (usuario_id, usuario_nombre, usuario_rol, categoria, accion, descripcion, entidad_tipo, entidad_id, meta)
  values
   (v_admin, 'Corrección OP-2026-063', 'administracion', 'FINANZAS', 'CORRECCION_PAGO_NO_REGISTRADO',
    'Cruce de $1.345,50 (despachos #4800 y #679) registrado con fecha 18-nov (orden del dueño, 2026-11-24)', 'cliente', v_cli,
    jsonb_build_object('caso','OP-2026-063','monto',1345.50,'forma_pago','Cruce','fecha_real','2026-11-18','saldo_anterior',1345.50,'saldo_nuevo',0,'saldo_a_favor',450,'autorizado_por','dueño'));
end $$;
