# OP-2026-059 — Prepara la rama de publicación en una carpeta aparte (git worktree), partiendo de
# origin/main (lo que hoy está en producción) y trayendo SOLO los archivos de CxC (OP-042, OP-049..OP-060).
# No toca la carpeta principal ni cambia su rama. No sube nada a GitHub.
# Archivos modificados: fusión de 3 vías (base = HEAD de la carpeta principal, nuestro = origin/main,
# suyo = carpeta principal), así se conserva lo que main ya tiene y se agrega solo lo de CxC.
import os, subprocess, shutil, sys, glob

SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DST = os.path.abspath(os.path.join(SRC, '..', 'construacero-publicacion-op059'))

MODIFICADOS = '''.gitignore README.md
api/handlers/__tests__/despachosAtomic.test.js api/handlers/__tests__/despachosReversionDevoluciones.test.js
api/handlers/__tests__/despachosReversionRelease17.test.js api/handlers/cotizaciones.js api/handlers/cxc.js
api/handlers/despachos.js api/lib/__tests__/audit.test.js api/lib/audit.js api/lib/cxcUtils.js
docs/operaciones/REGISTRO.md docs/operaciones/matriz-migraciones.md
src/components/clientes/FichaClienteModal.jsx src/components/despachos/DespachoCard.jsx
src/components/despachos/DevolucionParcialModal.jsx src/components/despachos/DevolverAnularModal.jsx
src/components/despachos/EditDespachoModal.jsx src/components/despachos/EditarItemsDespachoModal.jsx
src/components/despachos/EditarPagoEntregadoModal.jsx src/components/despachos/__tests__/EditarPagoEntregadoModal.test.js
src/components/ui/ConfirmModal.jsx src/hooks/useCuentasCobrar.js src/hooks/useDespachos.js
src/views/CotizacionesView.jsx src/views/DespachosView.jsx src/views/ReportesView.jsx src/views/VentaRapidaView.jsx
worker.js'''.split()

NUEVOS = '''api/handlers/__tests__/abonoClaveUnica049.test.js api/handlers/__tests__/cxcReparto042.test.js
api/handlers/__tests__/despachoPagos052.test.js api/handlers/__tests__/edicionProfundaCxc053.test.js
api/handlers/__tests__/saldoFavorAtomico051.test.js api/lib/__tests__/cxcUtilsFallo057.test.js
src/utils/__tests__/consistencia057.test.js src/utils/__tests__/cxcReparto.test.js
src/utils/__tests__/donacionDevolucion.test.js src/utils/__tests__/formaPagoReglas.test.js
src/utils/cxcReparto.js src/utils/cxcSaldos.js src/utils/donacionDevolucion.js src/utils/formaPagoReglas.js
src/utils/leerPaginado.js docs/operaciones/REGISTRO-FALLAS-CODIGO.md
docs/plans/OP-2026-048_plan-arreglo-26-fallas-staging.md'''.split()
NUEVOS += sorted(os.path.relpath(p, SRC).replace('\\', '/') for p in glob.glob(os.path.join(SRC, 'supabase/migrations/30[1-9]_*.sql')))
for n in range(37, 61):
    NUEVOS += sorted(os.path.relpath(p, SRC).replace('\\', '/') for p in glob.glob(os.path.join(SRC, f'docs/operaciones/OP-2026-0{n:02d}_*')) if os.path.isfile(p))
for d in ('OP-2026-040_scripts', 'OP-2026-059_scripts', 'OP-2026-060_scripts'):
    for raiz, _, archivos in os.walk(os.path.join(SRC, 'docs/operaciones', d)):
        if '__pycache__' in raiz: continue
        NUEVOS += [os.path.relpath(os.path.join(raiz, a), SRC).replace('\\', '/') for a in archivos if not a.endswith('.pyc')]
NUEVOS = [n for n in dict.fromkeys(NUEVOS) if '.env' not in n and n not in MODIFICADOS]

def git(*a, cwd=SRC, check=True):
    return subprocess.run(['git', *a], cwd=cwd, capture_output=True, check=check).stdout

def lf(b): return b.replace(b'\r\n', b'\n')

if not os.path.exists(DST):
    git('worktree', 'add', '-b', 'feat/op-059-cxc-produccion', DST, 'origin/main')

conflictos, tmp = [], os.path.join(DST, '.op059_tmp')
os.makedirs(tmp, exist_ok=True)
for f in MODIFICADOS:
    base = lf(git('show', f'HEAD:{f}'))
    suyo = lf(open(os.path.join(SRC, f), 'rb').read())
    destino = os.path.join(DST, f)
    nuestro = lf(open(destino, 'rb').read()) if os.path.exists(destino) else base
    for nombre, cont in (('base', base), ('suyo', suyo), ('nuestro', nuestro)):
        open(os.path.join(tmp, nombre), 'wb').write(cont)
    r = subprocess.run(['git', 'merge-file', '-p', '-L', 'main', '-L', 'base', '-L', 'op059',
                        os.path.join(tmp, 'nuestro'), os.path.join(tmp, 'base'), os.path.join(tmp, 'suyo')], capture_output=True)
    open(destino, 'wb').write(r.stdout)
    if r.returncode: conflictos.append((f, r.returncode))
shutil.rmtree(tmp)

for f in NUEVOS:
    os.makedirs(os.path.dirname(os.path.join(DST, f)), exist_ok=True)
    shutil.copyfile(os.path.join(SRC, f), os.path.join(DST, f))

print('Carpeta de publicación:', DST)
print('Modificados fusionados:', len(MODIFICADOS), '| Nuevos copiados:', len(NUEVOS))
print('Con conflictos:', conflictos or 'ninguno')
