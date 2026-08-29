// Saneamiento individual del caso Rosa Sánchez #2697 (único legacy con doble descuento).
// Convierte el abono 'Saldo a favor' ($4.14) en 'consumo_credito' para que la deuda
// COD quede en $60.43 exactos y la cajera pueda conciliar.
// Uso: node scripts/fix-despacho-2697-cxc.mjs [--apply]
// Sin --apply: solo muestra el plan (dry-run), no modifica nada.
import fs from 'node:fs'
import pg from 'pg'
function parse(f){const o={};fs.readFileSync(f,'utf8').split(/\r?\n/).forEach(l=>{const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim()});return o}
const e=parse('.env')
const APPLY=process.argv.includes('--apply')
const ABONO_ID='9a719bb0-8470-434f-9422-9f1ede324833'
const DESPACHO_ID='3a0a0bfb-2281-4c6c-aca3-2670cd6f01af'
const CLIENTE_ID='80a71d64-7975-4649-86e4-0dda45636da6'
const MONTO_ESPERADO=4.14
const CARGO_ESPERADO=60.43

const c=new pg.Client({host:'db.oyfyuszgjwcepjpngclv.supabase.co',port:5432,user:'postgres',password:e.DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}})
await c.connect()

// 1. Verificar el abono legacy con todos los campos
const {rows:abono}=await c.query(`SELECT * FROM public.cuentas_por_cobrar WHERE id=$1`,[ABONO_ID])
if(!abono[0]){console.error('ABORTAR: abono no encontrado');process.exit(1)}
const a=abono[0]
const okTipo=a.tipo==='abono'
const okForma=a.forma_pago_abono==='Saldo a favor'
const okMonto=Math.abs(Number(a.monto_usd)-MONTO_ESPERADO)<0.001
const okDespacho=a.despacho_id===DESPACHO_ID
const okCliente=a.cliente_id===CLIENTE_ID
console.log('Verificacion abono legacy:')
console.log(`  tipo=${a.tipo} (esp abono) ${okTipo?'OK':'FALLO'}`)
console.log(`  forma_pago=${a.forma_pago_abono} (esp Saldo a favor) ${okForma?'OK':'FALLO'}`)
console.log(`  monto=${a.monto_usd} (esp 4.14) ${okMonto?'OK':'FALLO'}`)
console.log(`  despacho_id=${a.despacho_id} ${okDespacho?'OK':'FALLO'}`)
console.log(`  cliente_id=${a.cliente_id} ${okCliente?'OK':'FALLO'}`)
if(!okTipo||!okForma||!okMonto||!okDespacho||!okCliente){console.error('ABORTAR: el abono no coincide con el caso esperado');process.exit(1)}

// 2. Verificar el cargo COD del despacho
const {rows:cargos}=await c.query(`SELECT * FROM public.cuentas_por_cobrar WHERE despacho_id=$1 AND tipo='cargo'`,[DESPACHO_ID])
const cargo=cargos[0]
const cargoOk=cargo && Math.abs(Number(cargo.monto_usd)-CARGO_ESPERADO)<0.001
console.log(`Cargo COD: ${cargo?Number(cargo.monto_usd).toFixed(2):'NO'} ${cargoOk?'OK':'FALLO'}`)
if(!cargoOk){console.error('ABORTAR: cargo COD no coincide con 60.43');process.exit(1)}

// 3. Estado actual del cliente
const {rows:cli}=await c.query(`SELECT saldo_pendiente,saldo_a_favor FROM public.clientes WHERE id=$1`,[CLIENTE_ID])
console.log(`Estado actual: saldo_pendiente=${Number(cli[0].saldo_pendiente).toFixed(2)} (doble descuento: 60.43-4.14=56.29) saldo_a_favor=${Number(cli[0].saldo_a_favor).toFixed(2)}`)

// 4. Plan
console.log('\nPLAN:')
console.log(`  DELETE abono ${ABONO_ID} (tipo=abono, Saldo a favor, $4.14)`)
console.log(`  INSERT consumo_credito (cliente=${CLIENTE_ID}, despacho=${DESPACHO_ID}, monto=4.14, forma_pago_abono='Saldo a favor')`)
console.log(`  Resultado esperado: saldo_pendiente=60.43, saldo_a_favor=0.00`)

if(!APPLY){console.log('\nDRY-RUN: no se modificó nada. Ejecutar con --apply para aplicar.');await c.end();process.exit(0)}

// 5. Aplicar en transacción
try{
  await c.query('BEGIN')
  // DELETE del abono legacy (dispara trigger delete -> recalcula)
  await c.query(`DELETE FROM public.cuentas_por_cobrar WHERE id=$1`,[ABONO_ID])
  // INSERT del consumo_credito (dispara trigger insert -> recalcula)
  await c.query(`INSERT INTO public.cuentas_por_cobrar (id,cliente_id,despacho_id,tipo,monto_usd,saldo_usd,forma_pago_abono,referencia,descripcion,registrado_por,metodo_pago)
    VALUES (gen_random_uuid(),$1,$2,'consumo_credito',4.14,0.00,'Saldo a favor',COALESCE($3,''),'Pago con Saldo a Favor (CREDITO)',$4,'cxc')`,
    [CLIENTE_ID,DESPACHO_ID,a.referencia,a.registrado_por])
  await c.query('COMMIT')
  console.log('APLICADO en transaccion')
}catch(err){await c.query('ROLLBACK').catch(()=>{});console.error('FALLO:',err.message);process.exit(1)}

// 6. Verificar resultado
const {rows:after}=await c.query(`SELECT saldo_pendiente,saldo_a_favor FROM public.clientes WHERE id=$1`,[CLIENTE_ID])
const debtOk=Math.abs(Number(after[0].saldo_pendiente)-60.43)<0.001
const favorOk=Math.abs(Number(after[0].saldo_a_favor)-0.00)<0.001
console.log(`Resultado: saldo_pendiente=${Number(after[0].saldo_pendiente).toFixed(2)} ${debtOk?'OK':'FALLO'} | saldo_a_favor=${Number(after[0].saldo_a_favor).toFixed(2)} ${favorOk?'OK':'FALLO'}`)
if(!debtOk||!favorOk){console.error('VERIFICACION FALLO — revisar');process.exit(1)}
await c.end()
console.log('SANEO ROSA #2697 COMPLETO')