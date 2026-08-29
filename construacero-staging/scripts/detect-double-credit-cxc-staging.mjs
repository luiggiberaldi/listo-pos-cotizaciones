// Solo lectura: detecta movimientos legacy de saldo a favor ligados a despachos
// con cargos COD/CxC. No modifica datos ni calcula reparaciones automáticas.
import fs from 'node:fs'
import pg from 'pg'
function parse(f){const o={};fs.readFileSync(f,'utf8').split(/\r?\n/).forEach(l=>{const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim()});return o}
const e={...parse('.env'),...parse('.dev.vars')}
const c=new pg.Client({host:'db.spupqgkdsgohxxfoxydl.supabase.co',port:5432,user:'postgres',password:e.PGPASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}})
await c.connect()
const {rows}=await c.query(`
SELECT a.id AS abono_id, a.cliente_id, a.despacho_id, a.monto_usd AS credito_consumido,
       d.numero, d.total_usd,
       COALESCE(SUM(CASE WHEN cargo.tipo='cargo' THEN cargo.monto_usd ELSE 0 END),0) AS cargos,
       COALESCE(SUM(CASE WHEN cargo.tipo='abono' AND cargo.forma_pago_abono <> 'Saldo a favor' THEN cargo.monto_usd ELSE 0 END),0) AS abonos_reales,
       c.saldo_pendiente, c.saldo_a_favor
FROM public.cuentas_por_cobrar a
JOIN public.notas_despacho d ON d.id=a.despacho_id
JOIN public.clientes c ON c.id=a.cliente_id
LEFT JOIN public.cuentas_por_cobrar cargo ON cargo.cliente_id=a.cliente_id AND cargo.despacho_id=a.despacho_id
WHERE a.tipo='abono' AND a.forma_pago_abono='Saldo a favor'
GROUP BY a.id,a.cliente_id,a.despacho_id,a.monto_usd,d.numero,d.total_usd,c.saldo_pendiente,c.saldo_a_favor
ORDER BY d.numero DESC`)
console.log(`CASOS LEGACY: ${rows.length}`)
for(const r of rows) console.log(JSON.stringify({...r, posible_doble_descuento: Number(r.cargos)>0}))
await c.end()
