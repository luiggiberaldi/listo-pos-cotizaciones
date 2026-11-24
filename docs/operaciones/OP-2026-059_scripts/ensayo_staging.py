# OP-2026-059 — Ensayo de las migraciones de PRODUCCIÓN 301-309 sobre STAGING, dentro de una
# transacción que SIEMPRE se deshace (ROLLBACK). Sirve para comprobar que el SQL es válido y que las
# funciones de producción se crean y responden, sin dejar ningún cambio en staging.
# Nunca se ejecuta contra producción.
# Uso: python ensayo_staging.py [archivo_sql_extra_con_pruebas]
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'OP-2026-040_scripts'))
from lib import q  # noqa: E402

MIG = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'supabase', 'migrations'))
ORDEN = ['301_cxc_reparto_devoluciones', '302_cxc_abono_clave_unica', '303_auditoria_categorias_y_abono_atomico',
         '304_cxc_saldo_favor_atomico', '305_despacho_pagos_al_reabrir_anular', '306_edicion_profunda_cxc',
         '307_devolucion_donacion', '308_cxc_nada_se_borra_sin_rastro', '309_reparto_dos_deudas']


def sin_transaccion(txt):
    return re.sub(r'^\s*(begin|commit)\s*;\s*$', '', txt, flags=re.I | re.M)


def armar(pruebas=''):
    partes = []
    for n in ORDEN:
        partes.append(f'-- ===== {n} =====\n' + sin_transaccion(open(os.path.join(MIG, n + '.sql'), encoding='utf-8').read()))
    return 'begin;\n' + '\n'.join(partes) + '\n' + pruebas + '\nrollback;\n'


if __name__ == '__main__':
    pruebas = open(sys.argv[1], encoding='utf-8').read() if len(sys.argv) > 1 else ''
    r = q('staging', armar(pruebas))
    print('RESULTADO:', r)
    # Confirmar que no quedó nada (la función nueva de producción no debe existir en staging)
    quedo = q('staging', "select count(*) n from pg_proc where proname in ('reabrir_despacho_con_pagos','cxc_anular_movimiento','devolucion_con_donacion')")
    print('Funciones de producción que quedaron en staging (debe ser 0):', quedo[0]['n'])
