# OP-2026-059 — Baja (solo lectura) las definiciones de funciones relacionadas, de producción y staging, a defs/<env>/
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'OP-2026-040_scripts'))
from lib import q
from comparar_esquema import FUNCS
base = os.path.join(os.path.dirname(__file__), 'defs')
for env in ('prod', 'staging'):
    os.makedirs(os.path.join(base, env), exist_ok=True)
    cond = ' or '.join(f"p.proname like '{f}'" for f in FUNCS)
    rows = q(env, f"""select p.proname, p.oid::text o, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='public' and ({cond}) order by 1,2""")
    seen = {}
    for r in rows:
        n = r['proname']; seen[n] = seen.get(n, 0) + 1
        fn = n + ('' if seen[n] == 1 else f'__{seen[n]}') + '.sql'
        open(os.path.join(base, env, fn), 'w', encoding='utf-8', newline='\n').write(r['d'])
    print(env, len(rows))
