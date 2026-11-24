-- OP-2026-056 (N4) — Corrección de los 13 registros viejos "Pago con Saldo a Favor…" guardados como ABONO.
-- NO EJECUTAR EN PRODUCCIÓN SIN APROBACIÓN EXPLÍCITA (caso propio).
-- Efecto simulado en producción (op056_n4_simulacion.py, 2026-11-24): 13 registros, $1.014,03, 11 clientes;
-- el "pagado de más" escondido baja de $1.013,69 a $0; solo FERRETERIA EL GRAN ADONAY cambia su deuda ($0 → $0,34);
-- ningún saldo a favor cambia.
-- Con la migración 307 (staging) el cambio de tipo no borra nada; igual se guarda copia en la auditoría.

begin;

-- Copia de lo que se va a cambiar (por si hay que deshacer)
create temporary table n4_respaldo on commit drop as
select * from public.cuentas_por_cobrar
 where tipo = 'abono' and forma_pago_abono = 'Saldo a favor' and descripcion ilike 'Pago con Saldo a Favor%';

-- Debe dar 13 filas y $1.014,03; si no, cancelar (rollback)
select count(*) as filas, round(sum(monto_usd), 2) as total from n4_respaldo;

insert into public.auditoria (usuario_nombre, usuario_rol, categoria, accion, descripcion, entidad_tipo, meta)
select 'Corrección N4', 'sistema', 'FINANZAS', 'CORRECCION_N4_ABONO_A_CONSUMO',
       format('Registro %s de $%s pasa de abono a consumo de saldo a favor (OP-2026-056)', id, round(monto_usd, 2)),
       'cliente', jsonb_build_object('copia', to_jsonb(r.*), 'caso', 'OP-2026-056')
  from n4_respaldo r;

update public.cuentas_por_cobrar c
   set tipo = 'consumo_credito'
  from n4_respaldo r
 where c.id = r.id;

-- Revisar el resultado antes de confirmar:
--   select tipo, count(*) from cuentas_por_cobrar where id in (select id from n4_respaldo) group by 1;
-- commit;   -- solo con aprobación
rollback;
