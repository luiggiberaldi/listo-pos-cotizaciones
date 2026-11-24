# OP-2026-044: cruce despacho por despacho (lee data.json, no consulta la base)
import json, collections
D = json.load(open('../../../.tmp-op040/op044/data.json', encoding='utf-8'))
CRED = {'Cta por cobrar', 'Credito', 'Crédito', 'Cuenta por cobrar'}

def fp(x):
    v = x.get('forma_pago_cliente') or x.get('forma_pago')
    if isinstance(v, str):
        try: v = json.loads(v)
        except Exception: v = [{'metodo': v, 'monto': x['total_usd']}]
    return v or []

metodos = collections.Counter()
for x in D['d']:
    for f in fp(x): metodos[f.get('metodo')] += 1
print('METODOS', dict(metodos))

audby = collections.defaultdict(list)
for a in D['aud']:
    if a['entidad_id']: audby[a['entidad_id']].append(a)

for cl in sorted(D['cl'], key=lambda c: -float(c['saldo_pendiente'])):
    cid = cl['id']
    ds = [x for x in D['d'] if x['cliente_id'] == cid or x['cliente_factura_id'] == cid]
    cs = [c for c in D['c'] if c['cliente_id'] == cid]
    tot = collections.defaultdict(float)
    for c in cs: tot[c['tipo']] += float(c['monto_usd'])
    calc = tot['cargo'] - tot['abono']
    print('\n' + '=' * 100)
    print(f"{cl['nombre']} #{cl['codigo_cliente']}  saldo={cl['saldo_pendiente']} favor={cl['saldo_a_favor']}  calc cargos-abonos={calc:.2f}  tipos={dict(tot)}")
    cargo_por_desp = collections.defaultdict(float)
    for c in cs:
        if c['tipo'] == 'cargo': cargo_por_desp[c['despacho_id']] += float(c['monto_usd'])
    for x in ds:
        f = fp(x)
        cred = sum(float(i.get('monto') or 0) for i in f if i.get('metodo') in CRED)
        otros = [(i.get('metodo'), i.get('monto'), i.get('referencia'), i.get('cobro_destino_pagado')) for i in f if i.get('metodo') not in CRED]
        cg = cargo_por_desp.get(x['id'], 0)
        flag = []
        if x['estado'] in ('despachada', 'entregada'):
            if abs(cg - cred) > 0.01: flag.append(f'CARGO {cg} != CREDITO {cred}')
            sumfp = sum(float(i.get('monto') or 0) for i in f)
            if abs(sumfp - float(x['total_usd'])) > 0.01: flag.append(f'FORMAS {sumfp} != TOTAL')
        elif cg: flag.append(f'CARGO {cg} EN DESPACHO {x["estado"]}')
        if abs(float(x['items_usd']) + float(x['flete_usd'] or 0) - float(x['total_usd'])) > 0.01 and abs(float(x['items_usd']) - float(x['total_usd'])) > 0.01:
            flag.append(f"ITEMS {x['items_usd']}+flete {x['flete_usd']} != total")
        print(f"  #{x['numero']} {x['creado_en'][:10]} {x['estado']:<10} tot={float(x['total_usd']):>9.2f} cred={cred:>9.2f} cargo={cg:>9.2f} otros={otros} {'dev' if x['tiene_devoluciones'] else ''} {' | '.join(flag)}")
        # historial de pagos con metodos no-credito que luego desaparecieron
        hist = set()
        for a in audby.get(x['id'], []) + [a for a in D['aud'] if (a['meta'] or {}).get('cotizacion_id') == x['cotizacion_id']]:
            m = a['meta'] or {}
            v = m.get('forma_pago')
            if isinstance(v, str):
                try: v = json.loads(v)
                except Exception: v = None
            for i in v or []:
                if i.get('metodo') not in CRED: hist.add((i.get('metodo'), i.get('monto'), a['ts'][:16]))
        actuales = {(o[0], o[1]) for o in otros}
        perdidos = [h for h in hist if (h[0], h[1]) not in actuales]
        if perdidos: print('     >> PAGO QUE ESTUVO Y YA NO ESTA:', sorted(perdidos, key=lambda h: h[2]))
    for c in cs:
        if c['tipo'] != 'cargo':
            print(f"   {c['creado_en'][:16]} {c['tipo']:<16} {float(c['monto_usd']):>9.2f} #{c['desp_num']} {c['metodo_pago']} | {c['forma_pago_abono']} | {c['referencia']} | {c['descripcion']}")
    huerf = [c for c in cs if c['tipo'] == 'cargo' and c['despacho_id'] not in {x['id'] for x in ds}]
    for c in huerf: print('   CARGO SIN DESPACHO', c['monto_usd'], c['descripcion'], c['creado_en'][:10])
    for dv in [v for v in D['dev'] if v['despacho_id'] in {x['id'] for x in ds}]:
        print('   DEVOLUCION', {k: dv[k] for k in dv if k in ('despacho_id', 'monto_usd', 'total_usd', 'creado_en', 'motivo', 'tipo', 'reembolso_usd', 'credito_usd')})
    acc = collections.Counter(a['accion'] for a in D['aud'] if cid in json.dumps(a, default=str) and a['categoria'] == 'FINANZAS')
    if acc: print('   AUDITORIA FINANZAS', dict(acc))
