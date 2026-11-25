// src/components/layout/HeaderTasas.jsx
// Bloque compartido de tasas del encabezado (BCV, EUR, USDT + widget de tasa activa).
// Usado tanto en AppLayout (con sesión de PIN) como en LoginPage (solo lectura antes del PIN).
import { useTasaCambio } from '../../hooks/useTasaCambio'
import BcvWidget from './BcvWidget'

function formatBs(value) {
  return value.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function HeaderTasas({ soloLectura = false }) {
  const { tasaBcv, tasaUsdt, tasaEuro } = useTasaCambio()

  return (
    <>
      {/* Tasas en Header - Solo en PC */}
      <div className="hidden md:flex items-center gap-3 mr-2 select-none">
        {tasaBcv?.precio > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 whitespace-nowrap">
            <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wider">BCV:</span>
            <span className="font-extrabold text-emerald-300 text-xs">
              Bs {formatBs(tasaBcv.precio)}
            </span>
          </div>
        )}
        {tasaEuro?.precio > 0 && (
          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 whitespace-nowrap">
            <span className="text-[10px] font-black text-blue-400 uppercase tracking-wider">EUR:</span>
            <span className="font-extrabold text-blue-300 text-xs">
              Bs {formatBs(tasaEuro.precio)}
            </span>
          </div>
        )}
        {tasaUsdt?.precio > 0 && (
          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 whitespace-nowrap">
            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-wider">USDT:</span>
            <span className="font-extrabold text-indigo-300 text-xs">
              Bs {formatBs(tasaUsdt.precio)}
            </span>
          </div>
        )}
      </div>

      {/* Widget BCV — supervisor puede configurar, vendedor / login solo ven la tasa */}
      <BcvWidget soloLectura={soloLectura} />
    </>
  )
}
