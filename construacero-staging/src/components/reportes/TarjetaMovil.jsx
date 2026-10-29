// src/components/reportes/TarjetaMovil.jsx
// En el celular, una fila de tabla se muestra como tarjeta: nombre arriba a la
// izquierda, el MONTO grande a la derecha (el dato que más importa) y el resto
// en líneas chicas debajo. En tableta/computadora se sigue usando la tabla.
//
// Uso:
//   <ListaMovil>
//     <TarjetaMovil titulo="Cliente" subtitulo="Vendedor" monto="$30,00"
//       detalles={[{ label: 'Riesgo', valor: 'Al día' }]} />
//   </ListaMovil>
//   <div className="hidden sm:block overflow-x-auto"> ...tabla... </div>

export function ListaMovil({ children, vacio = null }) {
  const hijos = Array.isArray(children) ? children.filter(Boolean) : children
  return (
    <div className="sm:hidden space-y-2 p-2">
      {(Array.isArray(hijos) && hijos.length === 0) ? vacio : hijos}
    </div>
  )
}

export default function TarjetaMovil({
  titulo,
  subtitulo = null,
  insignia = null,
  monto = null,
  montoEtiqueta = null,
  montoClase = 'text-slate-800',
  detalles = [],
  onClick = null,
  abierto = false,
  children = null,
}) {
  const Contenedor = onClick ? 'button' : 'div'
  return (
    <div className={`rounded-xl border bg-white ${abierto ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-slate-200'}`}>
      <Contenedor
        {...(onClick ? { type: 'button', onClick } : {})}
        className="w-full text-left p-3 flex flex-col gap-2"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-bold text-slate-800 leading-tight break-words">{titulo}</p>
              {insignia}
            </div>
            {subtitulo && <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{subtitulo}</p>}
          </div>
          {monto !== null && (
            <div className="text-right shrink-0">
              <p className={`text-base font-black leading-tight ${montoClase}`}>{monto}</p>
              {montoEtiqueta && <p className="text-[10px] text-slate-400 uppercase tracking-wide">{montoEtiqueta}</p>}
            </div>
          )}
        </div>
        {detalles.filter(Boolean).length > 0 && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            {detalles.filter(Boolean).map((d, i) => (
              <div key={i} className={`min-w-0 ${d.ancho ? 'col-span-2' : ''}`}>
                <dt className="text-[10px] text-slate-400 uppercase tracking-wide">{d.label}</dt>
                <dd className={`text-xs font-semibold break-words ${d.clase || 'text-slate-700'}`}>{d.valor}</dd>
              </div>
            ))}
          </dl>
        )}
      </Contenedor>
      {children && <div className="border-t border-slate-100 p-3">{children}</div>}
    </div>
  )
}
