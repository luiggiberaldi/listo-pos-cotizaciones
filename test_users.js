import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('c:\\Users\\luigg\\Desktop\\URO\\con worker 4000lines\\listo-pos-cotizaciones\\.env', 'utf-8')
const devVars = fs.readFileSync('c:\\Users\\luigg\\Desktop\\URO\\con worker 4000lines\\listo-pos-cotizaciones\\.dev.vars', 'utf-8')

let url = ''
let key = ''

envFile.split('\n').forEach(line => {
  if (line.startsWith('VITE_SUPABASE_URL=')) url = line.split('=')[1].trim()
})

devVars.split('\n').forEach(line => {
  if (line.startsWith('SUPABASE_SERVICE_KEY=')) key = line.split('=')[1].trim()
})

const supabase = createClient(url, key)

async function test() {
  const { data, error } = await supabase.from('usuarios').select('id, nombre, rol, cuenta_id').limit(20)
  
  if (error) {
    console.error('Error:', error)
  } else {
    console.table(data)
  }
}

test()
