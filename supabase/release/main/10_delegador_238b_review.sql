-- Release 10: delegador calcularcomisiondespacho → calcularcomisiondespacho_238b
-- Paridad con staging (migración 257). Cierra el agujero de la ruta de entrega:
-- la RPC confirmar_entrega_finanzas_idempotente llama a este calculador, que era
-- el legacy sin tranca COD (comision_cod_solo_pagado) y sin split de sábados.
-- Fuente: cuerpo vivo de staging verificado 2026-09-07 (tmp/delegador-stg257.sql).
CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho(p_despachoid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.calcularcomisiondespacho_238b(p_despachoid);
END
$function$;
