-- 281_guarda_precios_ddl.sql
--
-- GUARDA DE PRECIOS (principal/producción) — impide que el arreglo de precios
-- se pierda.
--
-- Motivo (forense 2026-10-25): en staging se aplicó a mano una variante del
-- arreglo SIN los comentarios-marcador y la verificación oficial (que busca
-- marcadores) reportó «no aplicado». Cualquier re-definición posterior de estas
-- funciones (un restore, un paquete release, un SQL pegado a mano) puede volver
-- a pisar los precios o a la semántica «vaciar no limpia» sin que nadie se dé
-- cuenta.
--
-- Qué hace: dos resortes (event triggers) que vigilan el DDL de las funciones
-- protegidas:
--   * al terminar CREATE/ALTER FUNCTION: si el cuerpo resultante NO conserva el
--     arreglo, la sentencia se RECHAZA entera (y la base queda como estaba);
--   * al borrar una función protegida (DROP): también se rechaza.
-- No toca datos ni interfiere con otras funciones.
--
-- Funciones protegidas (todos los escritores de precios de la ficha/lote):
--   * ingresar_lote_inventario_atomico (7 args) — el cuerpo debe llevar el
--     marcador del arreglo («ARREGLO …») y NO pisar precios de productos
--     existentes (patrón precio_usd = CASE WHEN COALESCE(v_item.precio_usd…).
--   * actualizar_producto_con_kardex (16 args) y
--     actualizar_producto_con_kardex_tenant_safe (21 args) — el cuerpo debe
--     llevar el marcador del contrato («contrato de precios») y NO volver a la
--     semántica COALESCE (patrón precio_2 = COALESCE(p_precio_2…) donde
--     vaciar no limpia).
-- Nota (verificación 2026-10-25, tarde): la variante de 16 args de producción YA
-- implementa el contrato de precios (su cuerpo es el de la migración 173: envío
-- directo y precio 0 = 0), aunque sin el comentario-marcador; y ya NO se usa
-- (última actividad real 2026-08-18; desde el 24-08 todo pasa por tenant_safe
-- vía Worker). Protegerla significa que su PRÓXIMA re-definición deberá llevar
-- el marcador del arreglo (o el pase autorizado), para que nadie la revierta.
--
-- Reversión autorizada (para los archivos *_rollback.sql o emergencias):
--   SET LOCAL app.precios_rollback_autorizado = 'REVERTIR_PRECIOS';
-- dentro de la MISMA transacción que hace el cambio (el error de la guarda lo
-- indica). Así lo hacen los archivos *_rollback.sql del lote de precios.
--
-- Para desactivar la guarda: 281_guarda_precios_ddl_rollback.sql.
-- Límites honestos:
--   * Protege contra re-definiciones «inadvertidas». Quien tenga acceso al rol
--     superusuario puede desactivar la guarda primero (queda rastro en el log).
--   * Un ALTER FUNCTION … RENAME escapa a la vigilancia (la función renombrada
--     dejaría de llamarse como la protegida; la app fallaría de forma ruidosa).

BEGIN;

CREATE OR REPLACE FUNCTION public.guarda_precios_ddl()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cmd        RECORD;
  v_nombre   TEXT;
  v_args     TEXT;
  v_nargs    INT;
  v_prosrc   TEXT;
  v_protegido BOOLEAN;
  v_es_lote  BOOLEAN;
  v_lista    TEXT;
BEGIN
  -- Reversión expresamente autorizada (transacción con SET LOCAL).
  IF current_setting('app.precios_rollback_autorizado', true) = 'REVERTIR_PRECIOS' THEN
    RETURN;
  END IF;

  v_lista := 'ingresar_lote_inventario_atomico (7 args), actualizar_producto_con_kardex (16 args), actualizar_producto_con_kardex_tenant_safe (21 args)';

  IF TG_EVENT = 'sql_drop' THEN
    FOR cmd IN
      SELECT object_type, object_identity FROM pg_event_trigger_dropped_objects()
    LOOP
      CONTINUE WHEN cmd.object_type IS DISTINCT FROM 'function';
      v_nombre := substring(cmd.object_identity FROM '^public\.([^(]+)\(');
      v_args   := substring(cmd.object_identity FROM '\((.*)\)$');
      v_nargs  := CASE WHEN btrim(COALESCE(v_args, '')) = '' THEN 0
                       ELSE array_length(string_to_array(v_args, ','), 1) END;
      v_protegido :=
        (v_nombre = 'ingresar_lote_inventario_atomico' AND v_nargs = 7)
        OR (v_nombre = 'actualizar_producto_con_kardex' AND v_nargs = 16)
        OR (v_nombre = 'actualizar_producto_con_kardex_tenant_safe' AND v_nargs = 21);
      CONTINUE WHEN NOT v_protegido;
      RAISE EXCEPTION
        'GUARDA_PRECIOS: se intentó BORRAR la función protegida % (protegidas: %). Si es una reversión de emergencia autorizada, ejecute dentro de la misma transacción: SET LOCAL app.precios_rollback_autorizado = ''REVERTIR_PRECIOS'';',
        cmd.object_identity, v_lista
        USING ERRCODE = 'P0001';
    END LOOP;
    RETURN;
  END IF;

  FOR cmd IN
    SELECT object_type, object_identity FROM pg_event_trigger_ddl_commands()
  LOOP
    CONTINUE WHEN cmd.object_type IS DISTINCT FROM 'function';

    v_nombre := substring(cmd.object_identity FROM '^public\.([^(]+)\(');
    v_args   := substring(cmd.object_identity FROM '\((.*)\)$');
    v_nargs  := CASE WHEN btrim(COALESCE(v_args, '')) = '' THEN 0
                     ELSE array_length(string_to_array(v_args, ','), 1) END;
    v_es_lote := (v_nombre = 'ingresar_lote_inventario_atomico' AND v_nargs = 7);
    v_protegido :=
      v_es_lote
      OR (v_nombre = 'actualizar_producto_con_kardex' AND v_nargs = 16)
      OR (v_nombre = 'actualizar_producto_con_kardex_tenant_safe' AND v_nargs = 21);
    CONTINUE WHEN NOT v_protegido;

    -- Identidad por nombre + nº de argumentos (la identidad textual viene con
    -- prefijos pg_catalog.* que no coinciden con pg_get_function_identity_arguments).
    SELECT p.prosrc INTO v_prosrc
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_nombre
      AND p.pronargs = v_nargs;

    IF v_prosrc IS NULL THEN
      RAISE EXCEPTION
        'GUARDA_PRECIOS: % quedó eliminada o renombrada (protegidas: %). Si es una reversión de emergencia autorizada, ejecute dentro de la misma transacción: SET LOCAL app.precios_rollback_autorizado = ''REVERTIR_PRECIOS'';',
        cmd.object_identity, v_lista
        USING ERRCODE = 'P0001';
    END IF;

    IF v_es_lote THEN
      IF v_prosrc NOT LIKE '%ARREGLO %'
         OR v_prosrc LIKE '%precio_usd = CASE WHEN COALESCE(v_item.precio_usd%' THEN
        RAISE EXCEPTION
          'GUARDA_PRECIOS: el nuevo cuerpo de % no conserva el arreglo de precios (falta el marcador «ARREGLO …» o vuelve a pisar precios de productos existentes). Use el archivo canónico 279_batch_ingest_no_pisa_precios.sql. Reversión autorizada: SET LOCAL app.precios_rollback_autorizado = ''REVERTIR_PRECIOS'';',
          cmd.object_identity
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      IF v_prosrc NOT LIKE '%contrato de precios%'
         OR v_prosrc LIKE '%precio_2 = COALESCE(p_precio_2%' THEN
        RAISE EXCEPTION
          'GUARDA_PRECIOS: el nuevo cuerpo de % no conserva el contrato de precios (falta el marcador «contrato de precios» o vuelve a la semántica COALESCE donde vaciar no limpia). Use el archivo canónico 280_precios_vacios_y_cero.sql. Reversión autorizada: SET LOCAL app.precios_rollback_autorizado = ''REVERTIR_PRECIOS'';',
          cmd.object_identity
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS guarda_precios_ddl;
DROP EVENT TRIGGER IF EXISTS guarda_precios_drop;
CREATE EVENT TRIGGER guarda_precios_ddl
  ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION', 'ALTER FUNCTION')
  EXECUTE FUNCTION public.guarda_precios_ddl();
CREATE EVENT TRIGGER guarda_precios_drop
  ON sql_drop
  WHEN TAG IN ('DROP FUNCTION')
  EXECUTE FUNCTION public.guarda_precios_ddl();

COMMENT ON FUNCTION public.guarda_precios_ddl() IS
  'Guarda de precios (2026-10-25): rechaza DDL que quite el arreglo de precios de ingresar_lote_inventario_atomico / actualizar_producto_con_kardex / actualizar_producto_con_kardex_tenant_safe (crear, reemplazar o borrar) salvo autorización explícita (app.precios_rollback_autorizado = REVERTIR_PRECIOS).';

NOTIFY pgrst, 'reload schema';
COMMIT;
