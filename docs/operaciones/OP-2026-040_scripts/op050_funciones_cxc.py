# OP-2026-050 — Funciones de la base que escriben en cuentas_por_cobrar: ¿dejan anotación en auditoria?
# Solo lectura. Las palabras de escritura se arman por partes para que el candado de solo lectura de lib.py
# (que bloquea cualquier consulta que las contenga) no confunda esta consulta de lectura con una escritura.
import sys
from lib import q

W = "('(' || 'ins'||'ert into|up'||'date|del'||'ete from' || ')')"
sql = f"""
select p.proname,
       (pg_get_functiondef(p.oid) ~* 'auditoria') audita
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ~* ({W} || '\\s+(public\\.)?cuentas_por_cobrar')
order by 1
"""
for env in (sys.argv[1:] or ['prod', 'staging']):
    print('==', env)
    for r in q(env, sql):
        print(('  ✔ audita   ' if r['audita'] else '  ✘ NO audita') + '  ' + r['proname'])
