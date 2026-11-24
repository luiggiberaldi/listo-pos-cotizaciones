-- OP-2026-060 — Registrar 4 pagos que sí se hicieron pero nunca se anotaron (OP-2026-039 / OP-2026-047).
-- BORRADOR. NO EJECUTAR EN PRODUCCIÓN SIN APROBACIÓN EXPLÍCITA DEL DUEÑO Y SIN CONFIRMAR LAS FECHAS (marcadas CONFIRMAR).
--
-- Idea: cada pago se guarda con la FECHA EN QUE REALMENTE SE PAGÓ (no con la de hoy). Así:
--   - los reportes de HOY no cambian (no aparece cobranza nueva hoy);
--   - el saldo de cada cliente queda en $0 de inmediato (lo recalculan los disparadores de la base);
--   - los reportes de los días/meses en que se pagó pasan a mostrar ese cobro (que es lo correcto).
-- Comisiones: ninguno de los 4 despachos tiene comisión pendiente de liberar (solo #3262, en $0). No cambia ninguna comisión.
-- Cada pago queda en la auditoría como corrección, con el caso y quién lo autorizó.

begin;

-- 1) Seguridad: solo seguir si las 4 deudas siguen exactamente como se estudiaron
do $$
declare v_ok int;
begin
  select count(*) into v_ok from public.clientes
   where (id = 'caf42772-64f8-40f0-a80b-5939ec041d46' and saldo_pendiente = 850.00)    -- Constructora Ew 2010
      or (id = 'c5f4c935-e409-4cf7-a553-fb8fb1fbe1db' and saldo_pendiente = 313.43)    -- Yahveh
      or (id = 'c3b76f18-39de-4abe-afc2-6955c1dc2f37' and saldo_pendiente = 64.50)     -- KIA 241
      or (id = '2137decd-6597-4aec-be79-be92d1d177d2' and saldo_pendiente = 60.59);    -- Albert Omar Ruiz
  if v_ok <> 4 then raise exception 'ALGUNA DEUDA CAMBIÓ (% de 4 coinciden): revisar antes de corregir', v_ok; end if;
end $$;

-- 2) Los 4 pagos, con su fecha real
create temporary table op060 (cliente uuid, despacho uuid, monto numeric, forma text, referencia text, descripcion text, fecha timestamptz) on commit drop;
insert into op060 values
  ('caf42772-64f8-40f0-a80b-5939ec041d46', '99606f6e-af01-46dc-926a-df89406566d9', 850.00, 'Cruce',
   'CONFIRMAR: contra qué se cruzó', 'Cruce despacho #3347 (corrección OP-2026-060)', '2026-09-21 12:00-04'),   -- CONFIRMAR fecha
  ('c5f4c935-e409-4cf7-a553-fb8fb1fbe1db', '26be284c-6450-45b5-aaa2-ae1d4085b9d1', 313.43, 'CONFIRMAR método',
   'CONFIRMAR referencia', 'Pago despacho #4804 (corrección OP-2026-060)', '2026-11-20 12:00-04'),               -- CONFIRMAR fecha
  ('c3b76f18-39de-4abe-afc2-6955c1dc2f37', '69436d71-248f-4736-a81e-c57784edc2cf', 64.50, 'CONFIRMAR método',
   'CONFIRMAR referencia', 'Diferencia de intercambio despacho #3596 (corrección OP-2026-060)', '2026-10-02 12:00-04'), -- CONFIRMAR fecha
  ('2137decd-6597-4aec-be79-be92d1d177d2', '953fd62c-bba3-4d70-b167-9d2738f6c3cf', 60.59, 'Transf. / Pago Móvil',
   '261114 (diferencia)', 'Resto despacho #3262, comprobante 261114 (corrección OP-2026-060)', '2026-09-29 12:00-04');

do $$ begin
  -- (también reemplazar 'CONFIRMAR nombre' en autorizado_por, más abajo)
  if exists (select 1 from op060 where forma like 'CONFIRMAR%' or referencia like 'CONFIRMAR%') then
    raise exception 'FALTAN DATOS: reemplazar todos los CONFIRMAR antes de ejecutar';
  end if;
end $$;

insert into public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, creado_en)
select cliente, despacho, 'abono', monto, 0, forma, referencia, descripcion, fecha from op060;

insert into public.auditoria (usuario_nombre, usuario_rol, categoria, accion, descripcion, entidad_tipo, entidad_id, meta)
select 'Corrección OP-2026-060', 'sistema', 'FINANZAS', 'CORRECCION_PAGO_NO_REGISTRADO',
       format('Pago de $%s del %s registrado con su fecha real (no se había anotado). Ref: %s', monto, fecha::date, referencia),
       'cliente', cliente,
       jsonb_build_object('caso', 'OP-2026-060', 'monto', monto, 'forma_pago', forma, 'referencia', referencia,
                          'despacho_id', despacho, 'fecha_real', fecha, 'autorizado_por', 'CONFIRMAR nombre')
  from op060;

-- 3) Revisar antes de confirmar: los 4 clientes deben quedar en $0
select id, nombre, saldo_pendiente, saldo_a_favor from public.clientes
 where id in (select cliente from op060);

-- Si todo está bien:  commit;   — si algo no cuadra:  rollback;
