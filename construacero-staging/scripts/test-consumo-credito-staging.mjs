// Smoke financiero staging: consumo_credito no reduce la deuda COD.
// Todas las filas se crean dentro de una transaccion y se revierten al final.
import fs from 'node:fs'
import pg from 'pg'
import assert from 'node:assert/strict'
function parse(f){const o={};fs.readFileSync(f,'utf8').split(/\r?\n/).forEach(l=>{const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim()});return o}
const e={...parse('.env'),...parse('.dev.vars')}
const c=new pg.Client({host:'db.spupqgkdsgohxxfoxydl.supabase.co',port:5432,user:'postgres',password:e.PGPASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}})
await c.connect()
const {rows:clients}=await c.query(`SELECT id,saldo_pendiente,saldo_a_favor FROM public.clientes WHERE activo=true ORDER BY creado_en LIMIT 1`)
const {rows:operators}=await c.query(`SELECT id FROM public.usuarios ORDER BY creado_en LIMIT 1`)
assert.ok(clients[0]&&operators[0],'faltan cliente/operador')
const client=clients[0]; const operator=operators[0].id
const baseDebt=Number(client.saldo_pendiente||0); const baseFavor=Number(client.saldo_a_favor||0)
console.log(`fixture cliente=${client.id} deudaInicial=${baseDebt} favorInicial=${baseFavor}`)
try {
  await c.query('BEGIN')
  await c.query(`INSERT INTO public.cuentas_por_cobrar (cliente_id,tipo,monto_usd,saldo_usd,descripcion,registrado_por,metodo_pago) VALUES ($1,'credito',100,0,'E2E-258 credito',$2,'cxc')`,[client.id,operator])
  await c.query(`INSERT INTO public.cuentas_por_cobrar (cliente_id,tipo,monto_usd,saldo_usd,descripcion,registrado_por,metodo_pago) VALUES ($1,'cargo',60.43,60.43,'E2E-258 COD',$2,'cod')`,[client.id,operator])
  await c.query(`INSERT INTO public.cuentas_por_cobrar (cliente_id,tipo,monto_usd,saldo_usd,forma_pago_abono,descripcion,registrado_por,metodo_pago) VALUES ($1,'consumo_credito',4.14,95.86,'Saldo a favor','E2E-258 consumo',$2,'cxc')`,[client.id,operator])
  let {rows:r}=await c.query(`SELECT saldo_pendiente,saldo_a_favor FROM public.clientes WHERE id=$1`,[client.id])
  let debt=Number(r[0].saldo_pendiente), favor=Number(r[0].saldo_a_favor)
  assert.equal(Number(debt.toFixed(4)),Number((baseDebt+60.43).toFixed(4)),'deuda COD alterada')
  assert.equal(Number(favor.toFixed(4)),Number((baseFavor+95.86).toFixed(4)),'favor incorrecto')
  console.log(`C1 PASS: deuda=${debt}, favor=${favor}`)
  await c.query(`INSERT INTO public.cuentas_por_cobrar (cliente_id,tipo,monto_usd,saldo_usd,forma_pago_abono,descripcion,registrado_por,metodo_pago) VALUES ($1,'abono',60.43,0,'Efectivo','E2E-258 conciliacion COD',$2,'cod')`,[client.id,operator])
  ;({rows:r}=await c.query(`SELECT saldo_pendiente,saldo_a_favor FROM public.clientes WHERE id=$1`,[client.id]))
  debt=Number(r[0].saldo_pendiente); favor=Number(r[0].saldo_a_favor)
  assert.equal(Number(debt.toFixed(4)),Number(baseDebt.toFixed(4)),'conciliacion no dejo deuda base')
  assert.equal(Number(favor.toFixed(4)),Number((baseFavor+95.86).toFixed(4)),'conciliacion altero favor')
  console.log(`C2 PASS: conciliacion COD -> deuda=${debt}, favor=${favor}`)
  await c.query(`DELETE FROM public.cuentas_por_cobrar WHERE cliente_id=$1 AND descripcion='E2E-258 consumo'`,[client.id])
  ;({rows:r}=await c.query(`SELECT saldo_pendiente,saldo_a_favor FROM public.clientes WHERE id=$1`,[client.id]))
  debt=Number(r[0].saldo_pendiente); favor=Number(r[0].saldo_a_favor)
  assert.equal(Number(debt.toFixed(4)),Number(baseDebt.toFixed(4)),'reversion altero deuda')
  assert.equal(Number(favor.toFixed(4)),Number((baseFavor+100).toFixed(4)),'reversion no repuso favor')
  console.log(`C3 PASS: reversion -> deuda=${debt}, favor=${favor}`)
  await c.query('ROLLBACK')
  console.log('C4 PASS: rollback sin residuos')
} catch(err){await c.query('ROLLBACK').catch(()=>{});console.error('E2E consumo_credito FAIL:',err.message);process.exit(1)}
await c.end()
console.log('CONSUMO-CREDITO STAGING PASS')
