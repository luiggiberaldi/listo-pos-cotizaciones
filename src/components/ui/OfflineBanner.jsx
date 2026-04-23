// src/components/ui/OfflineBanner.jsx
// Muestra banner "Sin conexión" / "Conexión restaurada"
import { useState, useEffect } from 'react'
import { WifiOff, Wifi } from 'lucide-react'

export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine)
  const [showRestored, setShowRestored] = useState(false)

  useEffect(() => {
    let timer
    function handleOnline() {
      setOnline(true)
      setShowRestored(true)
      timer = setTimeout(() => setShowRestored(false), 3000)
    }
    function handleOffline() {
      setOnline(false)
      setShowRestored(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearTimeout(timer)
    }
  }, [])

  if (online && !showRestored) return null

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2
        px-4 py-2.5 text-sm font-bold text-white transition-all duration-300 ${
        online ? 'bg-emerald-600' : 'bg-amber-600'
      }`}
    >
      {online ? (
        <><Wifi size={16} /> Conexión restaurada</>
      ) : (
        <><WifiOff size={16} /> Sin conexión — datos en modo offline</>
      )}
    </div>
  )
}
