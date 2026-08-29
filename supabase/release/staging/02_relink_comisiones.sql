-- CORRECCIÓN TRANSACCIONAL — staging únicamente
-- Proyecto esperado: spupqgkdsgohxxfoxydl
-- Destino: cuenta auth supervisor@listo.sys
--
-- Corrige solo la referencia histórica public.comisiones.cuentaid.
-- No modifica montos, estados, fechas, vendedores, despachos ni liberaciones.
-- No ejecutar en producción.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  v_destino UUID;
  v_total BIGINT;
  v_ya_destino BIGINT;
  v_validas BIGINT;
  v_actualizadas BIGINT;
BEGIN
  SELECT id
    INTO v_destino
  FROM auth.users
  WHERE lower(email) = 'supervisor@listo.sys';

  IF v_destino IS NULL THEN
    RAISE EXCEPTION 'COMISIONES_ABORTADO: no existe supervisor@listo.sys';
  END IF;

  SELECT count(*)
    INTO v_total
  FROM public.comisiones;

  SELECT count(*)
    INTO v_ya_destino
  FROM public.comisiones
  WHERE cuentaid = v_destino;

  IF v_total <> 654 THEN
    RAISE EXCEPTION 'COMISIONES_ABORTADO: se esperaban 654 comisiones y se encontraron %', v_total;
  END IF;

  IF v_ya_destino <> 0 THEN
    RAISE EXCEPTION 'COMISIONES_ABORTADO: ya existen % comisiones en la cuenta destino', v_ya_destino;
  END IF;

  -- Solo se permite mover filas cuyo vendedor y despacho ya pertenecen
  -- al tenant principal de staging. Esto evita mezclar el segundo tenant.
  SELECT count(*)
    INTO v_validas
  FROM public.comisiones c
  JOIN public.usuarios u ON u.id = c.vendedorid
  JOIN public.notas_despacho d ON d.id = c.despachoid
  WHERE u.cuenta_id = v_destino
    AND d.cuenta_id = v_destino;

  IF v_validas <> v_total THEN
    RAISE EXCEPTION 'COMISIONES_ABORTADO: solo % de % filas tienen vendedor y despacho en el destino', v_validas, v_total;
  END IF;

  UPDATE public.comisiones c
  SET cuentaid = v_destino
  WHERE c.cuentaid <> v_destino
    AND EXISTS (
      SELECT 1
      FROM public.usuarios u
      JOIN public.notas_despacho d ON d.id = c.despachoid
      WHERE u.id = c.vendedorid
        AND u.cuenta_id = v_destino
        AND d.cuenta_id = v_destino
    );

  GET DIAGNOSTICS v_actualizadas = ROW_COUNT;

  IF v_actualizadas <> v_total THEN
    RAISE EXCEPTION 'COMISIONES_ABORTADO: se actualizaron % filas en vez de %', v_actualizadas, v_total;
  END IF;

  IF (SELECT count(*) FROM public.comisiones WHERE cuentaid = v_destino) <> v_total THEN
    RAISE EXCEPTION 'COMISIONES_ABORTADO: la comprobación final no coincide';
  END IF;

  RAISE NOTICE 'Corrección confirmada: % comisiones enlazadas a staging', v_actualizadas;
END $$;

COMMIT;
