# OP-2026-047: funciones de la base que borran filas de cuentas_por_cobrar (solo lectura)
import sys
sys.path.insert(0, '.')
from lib import q
SQL = r"""
select p.proname,
  (select string_agg(t.tgname || ' en ' || c.relname, ', ') from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgfoid = p.oid) disparador,
  substring(pg_get_functiondef(p.oid) from '(?i)(d[e]lete\s+from\s+(?:public\.)?cuentas_por_cobrar[^;]{0,160})') fragmento
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) ~* 'd[e]lete\s+from\s+(public\.)?cuentas_por_cobrar'
order by 1
"""
for env in ('prod', 'staging'):
    print('==', env)
    for x in q(env, SQL):
        print('  ', x['proname'], '|', x['disparador'], '|', ' '.join((x['fragmento'] or '').split())[:200])
