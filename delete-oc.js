import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const envFile = fs.readFileSync('.env.local', 'utf8')
const supabaseUrl = envFile.match(/VITE_SUPABASE_URL=(.*)/)[1].trim()
const supabaseKey = envFile.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim()

const supabase = createClient(supabaseUrl, supabaseKey)

async function deleteOrder() {
  console.log('Borrando items de la orden de compra OC-00001...')
  const { data: orden, error: errOC } = await supabase
    .from('ordenes_compra')
    .select('id')
    .eq('numero', 1)
    .single()

  if (errOC || !orden) {
    console.error('Error buscando orden:', errOC)
    return
  }

  const { error: errItems } = await supabase
    .from('orden_compra_items')
    .delete()
    .eq('orden_compra_id', orden.id)

  if (errItems) {
    console.error('Error borrando items:', errItems)
    return
  }

  console.log('Borrando la orden de compra...')
  const { error } = await supabase
    .from('ordenes_compra')
    .delete()
    .eq('numero', 1)
  
  if (error) {
    console.error('Error borrando orden:', error)
  } else {
    console.log('¡Orden borrada exitosamente!')
  }
}

deleteOrder()
