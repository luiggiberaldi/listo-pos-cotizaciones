# OP-2026-059 — Aplica en PRODUCCIÓN las migraciones 301-309, en orden, una por una.
# Solo se ejecutó con la aprobación explícita del dueño (2026-11-24, "Sí, publica").
# Se detiene en el primer error. Uso: python aplicar_migraciones_prod.py [desde]  (ej. 304 para seguir desde ahí)
import json, os, sys, urllib.request, urllib.error
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'OP-2026-040_scripts'))
from lib import tok, CFG

MIG = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'supabase', 'migrations'))
ORDEN = ['301_cxc_reparto_devoluciones', '302_cxc_abono_clave_unica', '303_auditoria_categorias_y_abono_atomico',
         '304_cxc_saldo_favor_atomico', '305_despacho_pagos_al_reabrir_anular', '306_edicion_profunda_cxc',
         '307_devolucion_donacion', '308_cxc_nada_se_borra_sin_rastro', '309_reparto_dos_deudas']
desde = sys.argv[1] if len(sys.argv) > 1 else '301'

def ejecutar(sql):
    f, ref = CFG['prod']
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{ref}/database/query',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': 'Bearer ' + tok(f), 'Content-Type': 'application/json',
                                          'User-Agent': 'op059-publicacion'}, method='POST')
    return json.loads(urllib.request.urlopen(req, timeout=300).read().decode('utf-8'))

for n in ORDEN:
    if n[:3] < desde: continue
    sql = open(os.path.join(MIG, n + '.sql'), encoding='utf-8').read()
    try:
        ejecutar(sql)
        print('APLICADA', n, flush=True)
    except urllib.error.HTTPError as e:
        print('ERROR en', n, '->', e.read().decode()[:1500]); sys.exit(1)
print('LISTO: 9 migraciones aplicadas')
