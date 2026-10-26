// src/hooks/useClienteFresco.js
import { useEffect, useState } from 'react'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import { getOperatorSessionHeaders } from '../services/operatorSession'

// Refresca la ficha de un cliente al abrir un modal, SIN pasar por la caché de
// 5 minutos de las listas (useCotizaciones/useClientes). Motivo: el bloqueo del
// chofer local depende del estado ACTUAL del cliente y una copia vieja produce
// bloqueos fantasma ("indica el estado del destino" aunque el cliente ya tenga
// estado guardado). Si la consulta falla, devuelve null y cada pantalla sigue
// usando su copia local como respaldo.
export default function useClienteFresco(clienteId, activo = true) {
  const [resultado, setResultado] = useState({ id: null, cliente: null })

  useEffect(() => {
    if (!activo || !clienteId) return
    let cancelado = false
    ;(async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session
        const res = await fetch(apiUrl('/api/clientes/lookup'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
            ...getOperatorSessionHeaders(),
          },
          body: JSON.stringify({ ids: [clienteId] }),
        })
        const data = res.ok ? await res.json() : []
        if (!cancelado) setResultado({ id: clienteId, cliente: Array.isArray(data) ? (data[0] || null) : null })
      } catch {
        // Sin conexión o servidor caído: se conserva la copia local.
        if (!cancelado) setResultado({ id: clienteId, cliente: null })
      }
    })()
    return () => { cancelado = true }
  }, [clienteId, activo])

  // Solo se usa la respuesta si corresponde al cliente pedido: un cambio rápido
  // de cliente no debe mezclar datos viejos.
  return activo && resultado.id === clienteId ? resultado.cliente : null
}
