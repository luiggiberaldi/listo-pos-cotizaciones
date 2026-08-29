// src/lib/queryClient.js
// Instancia compartida de QueryClient para poder invalidar cache desde el auth store
import { QueryClient } from '@tanstack/react-query'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,        // 5 minutos — datos frescos sin refetch
      gcTime: 1000 * 60 * 60 * 24,     // 24h — requerido para persistencia IndexedDB
      retry: 1,
      refetchOnWindowFocus: false,       // don't refetch on tab switch — save egress
    },
  },
})

export default queryClient
