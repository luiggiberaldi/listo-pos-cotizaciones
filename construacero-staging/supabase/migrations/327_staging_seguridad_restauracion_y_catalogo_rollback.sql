-- Rollback de 327_staging_seguridad_restauracion_y_catalogo.sql (Solo STAGING).
-- Nota: no se revierte el endurecimiento A4 (auth.role() = 'service_role') ni la validación previa C3
-- salvo que se re-aplique explícitamente 322 y 317; los disparadores con la bandera son inocuos
-- cuando app.restaurando_respaldo no está activa.
BEGIN;
CREATE OR REPLACE FUNCTION public.tg_sincronizar_prestamos_cabecera()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public.sincronizar_prestamos_despacho(NEW.id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_sincronizar_prestamos_despacho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sincronizar_prestamos_despacho(OLD.despacho_id);
    RETURN OLD;
  ELSE
    PERFORM public.sincronizar_prestamos_despacho(NEW.despacho_id);
    RETURN NEW;
  END IF;
END;
$function$;
COMMIT;
