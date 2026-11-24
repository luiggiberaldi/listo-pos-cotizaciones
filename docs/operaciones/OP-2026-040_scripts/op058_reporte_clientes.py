# OP-2026-058 — Reporte de clientes (producción, SOLO LECTURA): cómo se ven hoy, con el código arreglado
# y con las correcciones de datos que falta aprobar (simuladas, sin escribir nada).
# Salida: docs/operaciones/OP-2026-058_reporte_clientes.csv y un resumen en pantalla.
import csv, io, json
from lib import q

FILTRO_N4 = "x.tipo = 'abono' and x.forma_pago_abono = 'Saldo a favor' and x.descripcion ilike 'Pago con Saldo a Favor%'"

base = q('prod', f"""
select c.id, c.nombre, c.saldo_pendiente::numeric deuda_guardada, c.saldo_a_favor::numeric favor_guardado,
  coalesce(sum(case when x.tipo='cargo' then x.monto_usd end),0) cargos,
  coalesce(sum(case when x.tipo='abono' then x.monto_usd end),0) abonos,
  coalesce(sum(case when {FILTRO_N4} then x.monto_usd end),0) n4,
  coalesce(sum(case when x.tipo='abono' and x.referencia ilike '%NO PROCEDE%' then x.monto_usd end),0) cruce_no_procede,
  count(x.id) movimientos
from clientes c join cuentas_por_cobrar x on x.cliente_id = c.id
group by c.id, c.nombre, c.saldo_pendiente, c.saldo_a_favor
""")

# Casos con corrección documentada que dependen de una decisión (cifras de los casos OP indicados)
DECISIONES = {
    'construacero los guayos': ('Deuda $1.700,50 y saldo a favor $0 si lo donado no da crédito', 'OP-2026-046', 'Administración'),
    'angel pineda': ('Debe $449,60 si llegó el Zelle de $3.557,50', 'OP-2026-044', 'Caja'),
    'juan carlos medrano': ('Entre $1.715,69 y $8.851,75 según caja (USDT del #3401 y posible doble conteo de $3.000)', 'OP-2026-044', 'Caja'),
    'reykar': ('Hasta $1.748,46 si uno de los dos $1.000 es repetido; ±$78 por el Zelle compartido', 'OP-2026-044', 'Caja'),
    'solidere': ('$34.266 si el Zelle de $78 era de REYKAR', 'OP-2026-043', 'Caja'),
    'carlos escalona': ('Pagado de más escondido $0 si se anula el abono duplicado', 'OP-2026-041', 'Caja'),
    'adalberto rojas': ('Según el origen que confirme caja ($1.051 pagados de más)', 'OP-2026-041', 'Caja'),
    'beatriz landadeta': ('Se anulan 2 abonos de prueba de $0,01', 'OP-2026-041', 'Administración'),
    'yhoel sanchez': ('Deuda +$500 si uno de los dos abonos de $500 (7 s de diferencia) es repetido', 'OP-2026-044', 'Caja'),
    'yahveh': ('Abono de $313,43 por Binance pendiente de confirmar: si llegó, se registra', 'OP-2026-047', 'Caja'),
}

def r2(v): return round(float(v) + 0.0, 2)
filas = []
for b in base:
    cargos, abonos = float(b['cargos']), float(b['abonos'])
    deuda_hoy = r2(b['deuda_guardada'] or 0)
    favor_hoy = r2(b['favor_guardado'] or 0)
    pdm = r2(max(0.0, abonos - cargos))
    # Con correcciones simuladas: N4 (exacta) y Cruce "NO PROCEDE" (Encendo)
    abonos_corr = abonos - float(b['n4']) - float(b['cruce_no_procede'])
    deuda_corr = r2(max(0.0, cargos - abonos_corr))
    pdm_corr = r2(max(0.0, abonos_corr - cargos))
    correcciones = []
    if float(b['n4']) > 0: correcciones.append(f"N4: ${r2(b['n4'])} pasa a consumo de saldo a favor (OP-2026-056)")
    if float(b['cruce_no_procede']) > 0: correcciones.append(f"Anular Cruce 'NO PROCEDE' de ${r2(b['cruce_no_procede'])} (OP-2026-041)")
    nombre_l = (b['nombre'] or '').lower()
    decision = next((v for k, v in DECISIONES.items() if k in nombre_l), None)
    if not (deuda_hoy > 0 or favor_hoy > 0 or pdm > 0 or correcciones or decision):
        continue
    filas.append({
        'cliente': b['nombre'], 'movimientos': b['movimientos'],
        'hoy_deuda': deuda_hoy, 'hoy_saldo_favor': favor_hoy, 'hoy_pagado_de_mas_escondido': pdm,
        'codigo_arreglado_deuda': deuda_hoy, 'codigo_arreglado_saldo_favor': favor_hoy, 'codigo_arreglado_pagado_de_mas_visible': pdm,
        'corregido_deuda': deuda_corr, 'corregido_pagado_de_mas': pdm_corr,
        'correcciones_simuladas': ' · '.join(correcciones),
        'decision_pendiente': decision[0] if decision else '', 'caso': decision[1] if decision else '', 'decide': decision[2] if decision else '',
    })

filas.sort(key=lambda f: (-(f['hoy_pagado_de_mas_escondido'] > 0), -f['hoy_deuda']))
ruta = '../OP-2026-058_reporte_clientes.csv'
with io.open(ruta, 'w', encoding='utf-8-sig', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(filas[0].keys()), delimiter=';')
    w.writeheader(); w.writerows(filas)

tot = lambda k: round(sum(f[k] for f in filas), 2)
print(json.dumps({
    'clientes_en_reporte': len(filas),
    'deuda_total_hoy': tot('hoy_deuda'), 'saldo_favor_total_hoy': tot('hoy_saldo_favor'),
    'pagado_de_mas_escondido_hoy': tot('hoy_pagado_de_mas_escondido'),
    'clientes_con_pagado_de_mas': sum(1 for f in filas if f['hoy_pagado_de_mas_escondido'] > 0),
    'deuda_total_con_correcciones_simuladas': tot('corregido_deuda'),
    'pagado_de_mas_con_correcciones_simuladas': tot('corregido_pagado_de_mas'),
    'clientes_con_decision_pendiente': sum(1 for f in filas if f['decision_pendiente']),
    'deuda_guardada_vs_calculada_distinta': sum(1 for b in base if abs(float(b['deuda_guardada'] or 0) - max(0.0, float(b['cargos']) - float(b['abonos']))) > 0.01),
}, ensure_ascii=False, indent=1))
print('\nCon pagado de más escondido hoy:')
for f in [x for x in filas if x['hoy_pagado_de_mas_escondido'] > 0]:
    print(f"  {f['cliente'][:40]:40} ${f['hoy_pagado_de_mas_escondido']:>10,.2f} → con correcciones ${f['corregido_pagado_de_mas']:,.2f} {('· ' + f['correcciones_simuladas']) if f['correcciones_simuladas'] else ''}")
print('\nDecisiones pendientes:')
for f in [x for x in filas if x['decision_pendiente']]:
    print(f"  {f['cliente'][:40]:40} hoy debe ${f['hoy_deuda']:,.2f} · {f['decision_pendiente']} ({f['caso']}, decide {f['decide']})")
