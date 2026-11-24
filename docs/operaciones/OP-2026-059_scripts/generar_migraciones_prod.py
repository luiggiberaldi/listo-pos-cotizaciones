# OP-2026-059 — Genera las migraciones de PRODUCCIÓN 301-309 a partir de las de staging 300-308.
# - Quita el sufijo _staging de las funciones nuevas.
# - Las funciones que YA existen en producción se reescriben partiendo de la definición ACTUAL de
#   producción (defs/prod/*.sql, bajada en solo lectura con dump_funciones.py), aplicando solo el
#   cambio de CxC. Nunca se copia el cuerpo de staging de una función que ya existe en producción.
# - Permisos: toda función nueva queda solo para service_role (el servidor), como en producción.
# Uso:  python generar_migraciones_prod.py      (escribe en supabase/migrations/)
# No toca ninguna base de datos.
import os
import re

AQUI = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(AQUI, '..', '..', '..'))
STG = os.path.join(ROOT, 'construacero-staging', 'supabase', 'migrations')
OUT = os.path.join(ROOT, 'supabase', 'migrations')
PROD = os.path.join(AQUI, 'defs', 'prod')

RENOMBRES = [
    ('reabrir_despacho_con_pagos_staging', 'reabrir_despacho_con_pagos'),
    ('anular_despacho_con_pagos_staging', 'anular_despacho_con_pagos'),
    ('editar_despacho_profundidad_con_cxc_staging', 'editar_despacho_profundidad_con_cxc'),
    ('devolucion_con_donacion_staging', 'devolucion_con_donacion'),
    ('cxc_anular_movimiento_staging', 'cxc_anular_movimiento'),
]

FIRMA16 = 'uuid,uuid,uuid,jsonb,jsonb,text,uuid,text,text,uuid,numeric,numeric,jsonb,jsonb,text,jsonb'


def leer(p):
    return open(p, encoding='utf-8').read().replace('\r\n', '\n')


def escribir(nombre, txt):
    with open(os.path.join(OUT, nombre), 'w', encoding='utf-8', newline='\n') as f:
        f.write(txt.rstrip('\n') + '\n')
    print('escrito', nombre)


def renombrar(txt):
    for a, b in RENOMBRES:
        txt = txt.replace(a, b)
    return txt


def sub1(txt, viejo, nuevo):
    n = txt.count(viejo)
    assert n == 1, f'esperaba 1 vez, hay {n}: {viejo[:70]!r}'
    return txt.replace(viejo, nuevo)


def defprod(nombre):
    return leer(os.path.join(PROD, nombre + '.sql')).rstrip() + ';\n'


def cabecera(prod, stg, op, notas=''):
    t = (f"-- {prod}.sql — PRODUCCIÓN (proyecto oyfyuszgjwcepjpngclv)\n"
         f"-- OP-2026-059: versión para producción de la migración de staging {stg}.sql ({op}).\n"
         f"-- PREPARADA, NO APLICADA. Aplicar solo con aprobación del dueño y en el orden de\n"
         f"-- docs/operaciones/OP-2026-059_paso-a-produccion-cxc.md. Reversa: {prod}_rollback.sql\n")
    if notas:
        t += '--\n' + ''.join('-- ' + l + '\n' for l in notas.strip('\n').split('\n'))
    return t + '--\n-- ── Texto de staging, adaptado (nombres sin "_staging") ──\n'


def limpiar_staging(txt):
    """Quita la primera línea de título de staging y las menciones 'solo STAGING'."""
    lineas = txt.split('\n')
    if lineas and lineas[0].startswith('-- ') and lineas[0].strip().endswith('.sql'):
        lineas = lineas[1:]
    txt = '\n'.join(lineas)
    for a, b in [('(solo STAGING)', ''), ('Solo STAGING. ', ''), ('Solo STAGING.', ''),
                 ('(solo STAGING: spupqgkdsgohxxfoxydl)', ''), ('solo STAGING', ''), ('Solo STAGING', '')]:
        txt = txt.replace(a, b)
    return txt


def revocar(funcs):
    return '\n'.join(f'revoke all on function public.{f} from public, anon, authenticated;\n'
                     f'grant execute on function public.{f} to service_role;' for f in funcs) + '\n'


# ───────────────────────── 301 (staging 300, OP-2026-042) ─────────────────────────
def m301():
    stg = leer(os.path.join(STG, '300_staging_cxc_reparto_devoluciones.sql'))
    ini = stg.index('CREATE OR REPLACE FUNCTION public.cxc_reparto_cliente')
    fin = stg.index('CREATE OR REPLACE FUNCTION public.ajustar_finanzas_devolucion_atomica')
    nuevo = stg[ini:fin]  # reparto, pendiente, vista (iguales en staging y producción)

    neta = defprod('ajustar_finanzas_devolucion_neta')
    neta = sub1(neta, "  v_refs_resumen       TEXT;\n",
                "  v_refs_resumen       TEXT;\n"
                "  -- OP-2026-042: abono manual que el operador confirma que era esta misma devolución\n"
                "  v_anular_id          UUID := NULLIF(btrim(COALESCE(current_setting('app.devolucion_anular_abono', TRUE), '')), '')::UUID;\n"
                "  v_abono_anular       RECORD;\n"
                "  v_abono_anulado      JSONB := NULL;\n")
    neta = sub1(neta,
                "  IF v_destino = 'reembolso' AND v_pagos_reembolso IS NULL THEN\n    RAISE EXCEPTION 'REEMBOLSO_PAGOS_REQUERIDOS';\n  END IF;\n",
                "  IF v_destino = 'reembolso' AND v_pagos_reembolso IS NULL THEN\n    RAISE EXCEPTION 'REEMBOLSO_PAGOS_REQUERIDOS';\n  END IF;\n"
                "  IF v_anular_id IS NOT NULL AND v_destino <> 'saldo_a_favor' THEN\n    RAISE EXCEPTION 'ANULAR_ABONO_SOLO_CON_SALDO_A_FAVOR';\n  END IF;\n")
    patron = re.compile(
        r"\n( *)SELECT COALESCE\(SUM\(CASE\n\s*WHEN c\.tipo = 'cargo' THEN c\.monto_usd\n"
        r"\s*WHEN c\.tipo = 'abono' THEN -c\.monto_usd\n\s*ELSE 0\n\s*END\), 0\)\n"
        r"\s*INTO v_cxc_despacho\n\s*FROM public\.cuentas_por_cobrar c\n"
        r"\s*WHERE c\.despacho_id = p_despacho_id;\n\n\s*v_cxc_despacho := GREATEST\(0, v_cxc_despacho\);\n")
    encontrados = list(patron.finditer(neta))
    assert len(encontrados) == 1, f'cálculo de v_cxc_despacho: {len(encontrados)} coincidencias'
    m = encontrados[0]
    i = m.group(1)
    bloque = f"""
{i}-- OP-2026-042 (falla G1): si el operador confirmó que un abono manual
{i}-- (p. ej. un "Cruce") era esta misma devolución, se anula aquí, dentro
{i}-- de la misma operación, para no cancelar dos veces el mismo crédito.
{i}IF v_anular_id IS NOT NULL THEN
{i}  SELECT * INTO v_abono_anular
{i}  FROM public.cuentas_por_cobrar
{i}  WHERE id = v_anular_id AND cliente_id = v_cliente.id AND tipo = 'abono'
{i}  FOR UPDATE;
{i}  IF NOT FOUND THEN
{i}    RAISE EXCEPTION 'ABONO_A_ANULAR_INVALIDO';
{i}  END IF;
{i}  IF v_abono_anular.despacho_id IS NOT NULL AND v_abono_anular.despacho_id <> p_despacho_id THEN
{i}    RAISE EXCEPTION 'ABONO_A_ANULAR_ES_DE_OTRO_DESPACHO';
{i}  END IF;
{i}  IF COALESCE(v_abono_anular.forma_pago_abono, '') IN ('Devolución', 'Saldo a favor') THEN
{i}    RAISE EXCEPTION 'ABONO_A_ANULAR_NO_PERMITIDO';
{i}  END IF;
{i}  v_abono_anulado := to_jsonb(v_abono_anular);
{i}  DELETE FROM public.cuentas_por_cobrar WHERE id = v_anular_id;
{i}END IF;

{i}-- OP-2026-042 (falla G1): lo pendiente del despacho se calcula con el
{i}-- MISMO reparto que la pantalla de CxC (abonos enlazados primero y luego
{i}-- los sueltos del más viejo al más nuevo). Antes solo se miraban los
{i}-- abonos enlazados y una devolución podía descontar dos veces.
{i}v_cxc_despacho := GREATEST(0, public.cxc_pendiente_despacho(v_cliente.id, p_despacho_id));
"""
    neta = neta[:m.start()] + bloque + neta[m.end():]
    neta = sub1(neta, "    'comision_ajustada', v_comision_ajustada,\n",
                "    'comision_ajustada', v_comision_ajustada,\n    'abono_anulado', v_abono_anulado,\n")

    cobro = defprod('registrar_devolucion_parcial_cobro_idempotente')
    cobro = sub1(cobro, "p_pagos_reembolso jsonb DEFAULT NULL::jsonb)",
                 "p_pagos_reembolso jsonb DEFAULT NULL::jsonb, p_anular_abono_id uuid DEFAULT NULL::uuid)")
    cobro = sub1(cobro, "  PERFORM set_config('app.devolucion_destino', v_destino, TRUE);\n",
                 "  PERFORM set_config('app.devolucion_destino', v_destino, TRUE);\n"
                 "  -- OP-2026-042: abono manual que el operador confirmó que era esta devolución (lo anula _neta)\n"
                 "  PERFORM set_config('app.devolucion_anular_abono', COALESCE(p_anular_abono_id::TEXT, ''), TRUE);\n")

    notas = """DIFERENCIA IMPORTANTE CON STAGING: en producción la devolución NO pasa por
ajustar_finanzas_devolucion_atomica (eso es solo de staging), sino por
  registrar_devolucion_parcial_cobro_idempotente -> registrar_devolucion_parcial_idempotente
  -> ajustar_finanzas_devolucion_neta.
Por eso aquí se modifica ajustar_finanzas_devolucion_neta, partiendo de su definición ACTUAL en
producción (bajada el 2026-11-24 en solo lectura), con los mismos 4 cambios que staging hizo en _atomica:
  1) variables v_anular_id / v_abono_anular / v_abono_anulado;
  2) error si se pide anular un abono con destino "reembolso";
  3) rama "saldo a favor": anular el abono confirmado y calcular lo pendiente del despacho con
     cxc_pendiente_despacho (mismo reparto que la pantalla);
  4) devolver 'abono_anulado' en el resultado.
registrar_devolucion_parcial_cobro_idempotente: cuerpo ACTUAL de producción + parámetro opcional
p_anular_abono_id. Permisos: SOLO service_role, igual que hoy en producción (staging lo abrió a anon y
authenticated; eso NO se copia).
ajustar_finanzas_devolucion_atomica NO se toca en producción (ninguna ruta la usa)."""
    txt = (cabecera('301_cxc_reparto_devoluciones', '300_staging_cxc_reparto_devoluciones', 'OP-2026-042', notas)
           + "\nBEGIN;\n\n" + nuevo + neta
           + "\nREVOKE ALL ON FUNCTION public.ajustar_finanzas_devolucion_neta(uuid, numeric, numeric, uuid, text) FROM PUBLIC, anon, authenticated;\n"
           + "GRANT EXECUTE ON FUNCTION public.ajustar_finanzas_devolucion_neta(uuid, numeric, numeric, uuid, text) TO service_role;\n\n"
           + f"DROP FUNCTION IF EXISTS public.registrar_devolucion_parcial_cobro_idempotente({FIRMA16});\n\n"
           + cobro
           + f"\nREVOKE ALL ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente({FIRMA16},uuid) FROM PUBLIC, anon, authenticated;\n"
           + f"GRANT EXECUTE ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente({FIRMA16},uuid) TO service_role;\n\n"
           + "NOTIFY pgrst, 'reload schema';\n\nCOMMIT;\n")
    escribir('301_cxc_reparto_devoluciones.sql', txt)

    rb = f"""-- 301_cxc_reparto_devoluciones_rollback.sql — PRODUCCIÓN
-- OP-2026-059. Deshace 301: deja ajustar_finanzas_devolucion_neta y registrar_devolucion_parcial_cobro_idempotente
-- EXACTAMENTE como estaban en producción el 2026-11-24 (copiadas de la base en solo lectura) y borra lo nuevo.
-- OJO: deshacer antes 307 (devolucion_con_donacion), que usa la firma nueva de la función de cobro.

BEGIN;

DROP FUNCTION IF EXISTS public.registrar_devolucion_parcial_cobro_idempotente({FIRMA16},uuid);

{defprod('registrar_devolucion_parcial_cobro_idempotente')}
REVOKE ALL ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente({FIRMA16}) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente({FIRMA16}) TO service_role;

{defprod('ajustar_finanzas_devolucion_neta')}
REVOKE ALL ON FUNCTION public.ajustar_finanzas_devolucion_neta(uuid, numeric, numeric, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajustar_finanzas_devolucion_neta(uuid, numeric, numeric, uuid, text) TO service_role;

DROP VIEW IF EXISTS public.v_cxc_pagado_de_mas;
DROP FUNCTION IF EXISTS public.cxc_pendiente_despacho(uuid, uuid);
DROP FUNCTION IF EXISTS public.cxc_reparto_cliente(uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
"""
    escribir('301_cxc_reparto_devoluciones_rollback.sql', rb)


# ─────────────── 302-309: funciones nuevas (se copian con el nombre de producción) ───────────────
def copiar(stg_base, prod_base, op, notas='', ajustes=(), extra_final='', transaccion=True):
    cuerpo = renombrar(limpiar_staging(leer(os.path.join(STG, stg_base + '.sql'))))
    for a, b in ajustes:
        cuerpo = sub1(cuerpo, a, b)
    txt = cabecera(prod_base, stg_base, op, notas)
    if transaccion:
        txt += '\nbegin;\n' + cuerpo.rstrip('\n') + '\n' + extra_final + "\nnotify pgrst, 'reload schema';\n\ncommit;\n"
    else:
        txt += cuerpo.rstrip('\n') + '\n' + extra_final + "\nnotify pgrst, 'reload schema';\n"
    escribir(prod_base + '.sql', txt)

    rb = renombrar(limpiar_staging(leer(os.path.join(STG, stg_base + '_rollback.sql'))))
    rb = (f"-- {prod_base}_rollback.sql — PRODUCCIÓN\n-- OP-2026-059. Reversa de {prod_base}.sql "
          f"(adaptada de {stg_base}_rollback.sql).\n" + rb.rstrip('\n') + '\n')
    if transaccion:
        rb = rb + "\nnotify pgrst, 'reload schema';\n"
    escribir(prod_base + '_rollback.sql', rb)


def main():
    m301()

    copiar('301_staging_cxc_abono_clave_unica', '302_cxc_abono_clave_unica', 'OP-2026-049',
           notas="Agrega la columna idempotency_key (vacía en las filas viejas) y un índice único parcial.\n"
                 "En producción la tabla tiene ~miles de filas: el índice se crea rápido; bloquea escrituras\n"
                 "de cuentas_por_cobrar solo mientras se construye (segundos).")

    copiar('302_staging_auditoria_categorias_y_abono_atomico', '303_auditoria_categorias_y_abono_atomico', 'OP-2026-050',
           notas="Sin BEGIN/COMMIT a propósito: 'alter type ... add value' debe quedar confirmado antes de usarse.\n"
                 "Las categorías nuevas NO se pueden quitar después (Postgres no lo permite); no hacen daño.",
           transaccion=False)

    copiar('303_staging_cxc_saldo_favor_atomico', '304_cxc_saldo_favor_atomico', 'OP-2026-051')

    # 305: reabrir llama a la reversión de PRODUCCIÓN (revertir_entrega_finanzas_idempotente)
    copiar('304_staging_despacho_pagos_al_reabrir_anular', '305_despacho_pagos_al_reabrir_anular', 'OP-2026-052',
           notas="""Cambio respecto de staging: reabrir_despacho_con_pagos llama a la reversión de PRODUCCIÓN,
revertir_entrega_finanzas_idempotente(cuenta, despacho, clave, ...), en vez de la de staging
(revertir_entrega_finanzas_atomica_staging, que no existe en producción). La cuenta se toma del propio
despacho. Si la reversión es una repetición (misma clave), se devuelve el resultado guardado sin volver a
anotar en la auditoría. La clave (p_idempotency_key) es obligatoria, igual que hoy en producción.""",
           ajustes=[
               ("  v_res        jsonb;\nbegin\n",
                "  v_res        jsonb;\n  v_cuenta     uuid;\nbegin\n"),
               ("  perform 1 from public.notas_despacho where id = p_despacho_id for update;\n  v_juego   := public.cxc_pagos_en_juego_despacho(p_despacho_id);\n  v_cliente := (v_juego->>'cliente_id')::uuid;",
                "  if p_idempotency_key is null then\n    raise exception 'IDEMPOTENCY_KEY_OBLIGATORIA' using errcode = 'P0001';\n  end if;\n"
                "  select cuenta_id into v_cuenta from public.notas_despacho where id = p_despacho_id for update;\n"
                "  if not found then raise exception 'DESPACHO_NO_ENCONTRADO' using errcode = 'P0001'; end if;\n"
                "  v_juego   := public.cxc_pagos_en_juego_despacho(p_despacho_id);\n  v_cliente := (v_juego->>'cliente_id')::uuid;"),
               ("  v_res := public.revertir_entrega_finanzas_atomica_staging(p_despacho_id, p_nuevo_estado, p_usuario_id,\n"
                "                                                           p_usuario_nombre, p_usuario_color, p_idempotency_key);\n",
                "  v_res := public.revertir_entrega_finanzas_idempotente(v_cuenta, p_despacho_id, p_idempotency_key, p_nuevo_estado,\n"
                "                                                       p_usuario_id, p_usuario_nombre, p_usuario_color);\n"
                "  -- Repetición de una reversión ya hecha (misma clave): no se vuelve a anotar nada\n"
                "  if coalesce((v_res->>'idempotent')::boolean, false) then\n    return v_res;\n  end if;\n"),
           ],
           extra_final=revocar(['cxc_es_pago_real(text)']))

    copiar('305_staging_edicion_profunda_cxc', '306_edicion_profunda_cxc', 'OP-2026-053',
           notas="Llama a editar_despacho_profundidad(uuid, jsonb, uuid, text, text, text), que es IDÉNTICA en\n"
                 "staging y producción (comparado el 2026-11-24).\n"
                 "Cambio respecto de staging: cuando la edición CREA una deuda nueva (crédito o cobro a destino),\n"
                 "se guarda su fecha de vencimiento (hoy + días indicados en la forma de pago), como hacía el\n"
                 "servidor de producción hasta ahora (staging la había omitido).",
           ajustes=[
               ("  v_ab       record;\nbegin\n",
                "  v_ab       record;\n  v_dias_cxc integer;\n  v_dias_cod integer;\nbegin\n"),
               ("  v_vuelto := case when v_vuelto_flag",
                "  -- Días de vencimiento indicados en la forma de pago (para la fecha de una deuda nueva)\n"
                "  select max(public.cxc_num(f->>'diasVencimiento')) filter (where f->>'metodo' = 'Cta por cobrar'),\n"
                "         max(public.cxc_num(f->>'diasVencimiento')) filter (where f->>'metodo' = 'Cobro a destino')\n"
                "    into v_dias_cxc, v_dias_cod\n"
                "    from jsonb_array_elements(v_fp) f;\n"
                "  v_vuelto := case when v_vuelto_flag"),
               ("      insert into public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, descripcion, registrado_por, metodo_pago)\n"
                "      values (v_cliente, p_despacho_id, 'cargo', round(v_target, 4), round(v_target, 4),\n",
                "      insert into public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, descripcion, registrado_por, metodo_pago, fecha_vencimiento)\n"
                "      values (v_cliente, p_despacho_id, 'cargo', round(v_target, 4), round(v_target, 4),\n"),
               ("              p_usuario_id, v_met);\n",
                "              p_usuario_id, v_met,\n"
                "              case when coalesce(case v_met when 'cxc' then v_dias_cxc else v_dias_cod end, 0) > 0\n"
                "                   then current_date + (case v_met when 'cxc' then v_dias_cxc else v_dias_cod end) end);\n"),
           ],
           extra_final=revocar(['cxc_num(text)']))

    copiar('306_staging_devolucion_donacion', '307_devolucion_donacion', 'OP-2026-054',
           notas="Necesita 301 (usa la firma de 17 parámetros de registrar_devolucion_parcial_cobro_idempotente).",
           extra_final=revocar(['cxc_restar_donacion_fp(text, numeric)']))

    copiar('307_staging_cxc_nada_se_borra_sin_rastro', '308_cxc_nada_se_borra_sin_rastro', 'OP-2026-055',
           notas="Crea la tabla-archivo cxc_movimientos_borrados y un disparador que copia ahí toda fila de\n"
                 "cuentas_por_cobrar que se borre. Desde este paso, borrar movimientos deja rastro.",
           extra_final="revoke all on function public.trg_archivar_cxc_borrado() from public, anon, authenticated;\n")

    copiar('308_staging_reparto_dos_deudas', '309_reparto_dos_deudas', 'OP-2026-057')


if __name__ == '__main__':
    main()
