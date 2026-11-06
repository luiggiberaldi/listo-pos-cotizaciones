import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright'
const leer=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split(/\r?\n/).filter(l=>/^[A-Za-z0-9_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]))
const st='construacero-staging';const cfg={...leer(`${st}/.env`),...leer(`${st}/.dev.vars`),...leer(`${st}/.env.e2e.local`)}
if(!cfg.VITE_SUPABASE_URL.includes('spupqgkdsgohxxfoxydl'))throw new Error('solo staging')
const b=await chromium.launch();const page=await (await b.newContext({viewport:{width:1400,height:800}})).newPage()
await page.goto('http://localhost:4173/login');await page.fill('input[placeholder="correo@empresa.com"]',cfg.STAGING_E2E_EMAIL);await page.fill('input[placeholder="••••••••"]',cfg.STAGING_E2E_PASSWORD);await page.click('button:has-text("Acceder")')
await page.waitForSelector('text=Selecciona tu usuario e ingresa tu PIN')
for(let i=0;i<10;i++)await page.click('img[alt="Construacero Carabobo"]')
await page.fill('input[aria-label="Código de desarrollador"]',cfg.DEV_SUPER_CODE);await page.click('form:has(input[aria-label="Código de desarrollador"]) button[type="submit"]')
await page.waitForSelector('a[href="/reportes"]');await page.click('a[href="/reportes"]')
await page.waitForTimeout(2500)
// frenar la red para que se vea el estado "actualizando"
await page.route('**/api/comisiones/**', async r => { await new Promise(x=>setTimeout(x,4000)); r.continue() })
await page.locator('button:has-text("Ayer")').first().click()
await page.waitForSelector('text=Actualizando',{timeout:5000})
await page.screenshot({path:'tmp/aviso-inline.png'})
await b.close()
