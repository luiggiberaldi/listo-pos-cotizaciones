import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

// Intentaremos leer desde el .env del proyecto
const envFile = fs.readFileSync('c:\\Users\\luigg\\Desktop\\URO\\con worker 4000lines\\listo-pos-cotizaciones\\.env', 'utf-8')

let url = ''
let key = ''

envFile.split('\n').forEach(line => {
  if (line.startsWith('VITE_SUPABASE_URL=')) url = line.split('=')[1].trim()
  if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) key = line.split('=')[1].trim()
})

const supabase = createClient(url, key)

async function test() {
  const { data, error } = await supabase.rpc('obtener_reporte_ventas_comisiones', {
    p_fecha_inicio: null,
    p_fecha_fin: null,
    p_vendedor_id: null
  })
  
  if (error) {
    console.error('Error:', error)
  } else {
    console.log('Filas obtenidas:', data?.length)
    if (data?.length > 0) {
      // Sum the total_com per vendedor
      const sums = {}
      data.forEach(d => {
        if (!sums[d.asesor]) sums[d.asesor] = 0
        sums[d.asesor] += Number(d.total_com)
      })
      console.log('Sumas por asesor en RPC:', sums)
    }
  }
}

test()
