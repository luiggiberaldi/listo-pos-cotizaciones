// src/components/ui/PageHeader.jsx
// Header slim accent — línea gold + fondo blanco, fluye con el contenido
export default function PageHeader({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4"
      style={{ borderBottom: '1px solid #e2e8f0' }}
    >
      {/* Izquierda: barra accent + icono + título */}
      <div className="flex items-center gap-3.5">
        {/* Barra vertical gold-navy */}
        <div className="w-1 self-stretch rounded-full shrink-0"
          style={{ background: 'linear-gradient(180deg, #B8860B 0%, #1B365D 100%)', minHeight: '36px' }} />

        {/* Ícono */}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(27,54,93,0.08) 0%, rgba(184,134,11,0.08) 100%)',
            border: '1px solid rgba(27,54,93,0.12)',
          }}
        >
          {Icon && <Icon size={18} style={{ color: '#1B365D' }} />}
        </div>

        {/* Texto */}
        <div>
          <h1 className="text-xl font-black text-slate-800 leading-tight tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-xs font-medium text-slate-400 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Derecha: acción */}
      {action && (
        <div className="shrink-0 pl-5 sm:pl-0">
          {action}
        </div>
      )}
    </div>
  )
}
