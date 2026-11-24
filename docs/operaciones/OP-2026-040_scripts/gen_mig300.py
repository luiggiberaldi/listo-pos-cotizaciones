# Genera la migracion 300 (y su rollback) a partir de los cuerpos vivos de staging.
cs = open('fn_registrar_devolucion_parcial_cobro_staging.sql', encoding='utf-8').read()
ci = open('fn_registrar_devolucion_parcial_cobro_idempotente.sql', encoding='utf-8').read()
aj = open('ajustar_nuevo.sql', encoding='utf-8').read()
aj_old = open('fn_ajustar_finanzas_devolucion_atomica.sql', encoding='utf-8').read()


def addparam(s):
    old = "p_pagos_reembolso jsonb DEFAULT NULL::jsonb)"
    assert s.count(old) == 1
    return s.replace(old, "p_pagos_reembolso jsonb DEFAULT NULL::jsonb, p_anular_abono_id uuid DEFAULT NULL::uuid)")


cs2 = addparam(cs)
old = "  PERFORM set_config(\n    'app.devolucion_reembolso_pagos',"
assert cs2.count(old) == 1
cs2 = cs2.replace(old, "  -- OP-2026-042: abono manual que el operador confirma que era esta devolucion.\n"
                       "  PERFORM set_config('app.devolucion_anular_abono', COALESCE(p_anular_abono_id::TEXT, ''), TRUE);\n" + old)
ci2 = addparam(ci)
old = "    p_pagos_reembolso\n  );"
assert ci2.count(old) == 1
ci2 = ci2.replace(old, "    p_pagos_reembolso,\n    p_anular_abono_id\n  );")

SIG = "uuid,uuid,uuid,jsonb,jsonb,text,uuid,text,text,uuid,numeric,numeric,jsonb,jsonb,text,jsonb"
reparto = open('reparto.sql', encoding='utf-8').read()

mig = "\n".join([
    "-- 300_staging_cxc_reparto_devoluciones.sql",
    "-- OP-2026-042: arreglos de Cuentas por Cobrar (solo STAGING: spupqgkdsgohxxfoxydl)",
    "--",
    "-- 1. cxc_reparto_cliente / cxc_pendiente_despacho: la MISMA regla de reparto que la",
    "--    pantalla de CxC (src/utils/cxcReparto.js): abonos enlazados primero y luego los",
    "--    sueltos, del cargo mas viejo al mas nuevo.",
    "-- 2. v_cxc_pagado_de_mas: clientes cuyos abonos superan sus cargos (falla G3).",
    "-- 3. ajustar_finanzas_devolucion_atomica: la devolucion usa ese reparto (falla G1) y",
    "--    puede anular, en la misma operacion, un abono manual que el operador confirma que",
    "--    era esta misma devolucion (caso Decoraciones Encendo).",
    "-- 4. registrar_devolucion_parcial_cobro_staging / _idempotente: parametro opcional",
    "--    p_anular_abono_id. Se reemplaza la firma anterior.",
    "-- Rollback: 300_staging_cxc_reparto_devoluciones_rollback.sql",
    "",
    "BEGIN;",
    "",
    reparto.rstrip(),
    "",
    aj.rstrip() + ";",
    "",
    f"DROP FUNCTION IF EXISTS public.registrar_devolucion_parcial_cobro_idempotente({SIG});",
    f"DROP FUNCTION IF EXISTS public.registrar_devolucion_parcial_cobro_staging({SIG});",
    "",
    cs2.rstrip() + ";",
    "",
    ci2.rstrip() + ";",
    "",
    f"REVOKE ALL ON FUNCTION public.registrar_devolucion_parcial_cobro_staging({SIG},uuid) FROM PUBLIC, anon, authenticated;",
    f"GRANT EXECUTE ON FUNCTION public.registrar_devolucion_parcial_cobro_staging({SIG},uuid) TO service_role;",
    f"GRANT EXECUTE ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente({SIG},uuid) TO anon, authenticated, service_role;",
    "",
    "NOTIFY pgrst, 'reload schema';",
    "",
    "COMMIT;",
    "",
])

rb = "\n".join([
    "-- 300_staging_cxc_reparto_devoluciones_rollback.sql",
    "-- Vuelve STAGING al estado anterior a OP-2026-042 (cuerpos copiados de la base el 2026-11-23).",
    "BEGIN;",
    "",
    f"DROP FUNCTION IF EXISTS public.registrar_devolucion_parcial_cobro_idempotente({SIG},uuid);",
    f"DROP FUNCTION IF EXISTS public.registrar_devolucion_parcial_cobro_staging({SIG},uuid);",
    "",
    cs.rstrip() + ";",
    "",
    ci.rstrip() + ";",
    "",
    f"REVOKE ALL ON FUNCTION public.registrar_devolucion_parcial_cobro_staging({SIG}) FROM PUBLIC, anon, authenticated;",
    f"GRANT EXECUTE ON FUNCTION public.registrar_devolucion_parcial_cobro_staging({SIG}) TO service_role;",
    f"GRANT EXECUTE ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente({SIG}) TO anon, authenticated, service_role;",
    "",
    aj_old.rstrip() + ";",
    "",
    "DROP VIEW IF EXISTS public.v_cxc_pagado_de_mas;",
    "DROP FUNCTION IF EXISTS public.cxc_pendiente_despacho(uuid, uuid);",
    "DROP FUNCTION IF EXISTS public.cxc_reparto_cliente(uuid);",
    "",
    "NOTIFY pgrst, 'reload schema';",
    "",
    "COMMIT;",
    "",
])

d = 'C:/Users/luigg/Desktop/construacero/construacero-staging/supabase/migrations/'
open(d + '300_staging_cxc_reparto_devoluciones.sql', 'w', encoding='utf-8', newline='\n').write(mig)
open(d + '300_staging_cxc_reparto_devoluciones_rollback.sql', 'w', encoding='utf-8', newline='\n').write(rb)
print('migracion', len(mig), 'rollback', len(rb))
