// src/components/reportes/TablaVendedores.jsx
import { Trophy, Briefcase, Users } from 'lucide-react'
import { fmtUsd } from '../../utils/format'

function Barra({ pct, color }) {
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex-1 max-w-[120px]">
      <div className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.max(pct, 2)}%`, background: color }} />
    </div>
  )
}

export default function TablaVendedores({ data = [] }) {
  if (data.length === 0) return null

  const maxUsd = Math.max(...data.map(v => v.totalUsd), 1)

  // Separar internos de externos
  const esVendedorExterno = (v) => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0);
  const internos = data.filter(v => !esVendedorExterno(v))
  const externos = data.filter(v => esVendedorExterno(v))

  // Calcular subtotales
  const calcSub = (arr) => {
    const despachos = arr.reduce((s, v) => s + (v.despachos || 0), 0)
    const totalUsd = arr.reduce((s, v) => s + (v.totalUsd || 0), 0)
    const comision = arr.reduce((s, v) => s + (v.comision || 0), 0)
    const ticketProm = despachos > 0 ? totalUsd / despachos : 0
    return { despachos, totalUsd, comision, ticketProm }
  }

  const subInternos = calcSub(internos)
  const subExternos = calcSub(externos)
  const totalGlobal = calcSub(data)

  const renderRow = (v, i) => {
    const esExterno = esVendedorExterno(v)
    const colorVendedor = esExterno ? '#D97706' : v.color
    return (
      <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50/50">
        <td className="px-4 py-3 text-slate-400 font-bold">{i + 1}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0 shadow-inner"
              style={{ background: colorVendedor }}>
              {v.nombre[0].toUpperCase()}
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-slate-700">{v.nombre}</span>
              {esExterno && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded px-1.5 py-0.2 w-fit mt-0.5">
                  💼 Vendedor Externo (+{v.markup_pct}%)
                </span>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-center text-slate-600 font-medium">{v.despachos}</td>
        <td className="px-4 py-3 text-right font-bold text-slate-800">{fmtUsd(v.totalUsd)}</td>
        <td className="px-4 py-3 text-right text-slate-500">{fmtUsd(v.despachos > 0 ? v.totalUsd / v.despachos : 0)}</td>
        <td className="px-4 py-3 text-right text-emerald-600 font-semibold">{fmtUsd(v.comision)}</td>
        <td className="px-4 py-3"><Barra pct={(v.totalUsd / maxUsd) * 100} color={colorVendedor} /></td>
      </tr>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50">
        <Trophy size={16} className="text-amber-500" />
        <h3 className="text-sm font-black text-slate-800">Ventas por vendedor</h3>
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
              <th className="text-left px-4 py-2.5 font-semibold w-8">#</th>
              <th className="text-left px-4 py-2.5 font-semibold">Vendedor</th>
              <th className="text-center px-4 py-2.5 font-semibold w-20">Despachos</th>
              <th className="text-right px-4 py-2.5 font-semibold w-28">Total USD</th>
              <th className="text-right px-4 py-2.5 font-semibold w-28">Ticket prom.</th>
              <th className="text-right px-4 py-2.5 font-semibold w-24">Comisión</th>
              <th className="px-4 py-2.5 w-32"></th>
            </tr>
          </thead>
          <tbody>
            {/* 1. SECCIÓN ASESORES INTERNOS */}
            {internos.length > 0 && (
              <>
                <tr className="bg-slate-50 font-extrabold text-slate-500 text-[10px] tracking-wider border-b border-slate-100">
                  <td colSpan={7} className="px-4 py-2 flex items-center gap-1.5 uppercase">
                    <Users size={12} className="text-slate-400" />
                    Vendedores Internos
                  </td>
                </tr>
                {internos.map((v, i) => renderRow(v, i))}
                {/* Subtotal Internos */}
                <tr className="bg-slate-50/30 font-bold text-slate-600 border-b border-slate-100 text-xs">
                  <td className="px-4 py-2"></td>
                  <td className="px-4 py-2 uppercase text-[9px] font-black text-slate-400">Subtotal Internos</td>
                  <td className="px-4 py-2 text-center text-slate-500 font-semibold">{subInternos.despachos}</td>
                  <td className="px-4 py-2 text-right text-slate-700 font-semibold">{fmtUsd(subInternos.totalUsd)}</td>
                  <td className="px-4 py-2 text-right text-slate-400">{fmtUsd(subInternos.ticketProm)}</td>
                  <td className="px-4 py-2 text-right text-emerald-600 font-semibold">{fmtUsd(subInternos.comision)}</td>
                  <td className="px-4 py-2"></td>
                </tr>
              </>
            )}

            {/* 2. SECCIÓN VENDEDORES EXTERNOS */}
            {externos.length > 0 && (
              <>
                <tr className="bg-amber-50/50 font-extrabold text-amber-700 text-[10px] tracking-wider border-b border-amber-100 border-t border-slate-100">
                  <td colSpan={7} className="px-4 py-2 flex items-center gap-1.5 uppercase">
                    <Briefcase size={12} className="text-amber-600" />
                    Vendedores Externos
                  </td>
                </tr>
                {externos.map((v, i) => renderRow(v, i))}
                {/* Subtotal Externos */}
                <tr className="bg-amber-50/10 font-bold text-amber-800 border-b border-amber-100 text-xs">
                  <td className="px-4 py-2"></td>
                  <td className="px-4 py-2 uppercase text-[9px] font-black text-amber-600/70">Subtotal Externos</td>
                  <td className="px-4 py-2 text-center text-amber-700 font-semibold">{subExternos.despachos}</td>
                  <td className="px-4 py-2 text-right text-amber-900 font-semibold">{fmtUsd(subExternos.totalUsd)}</td>
                  <td className="px-4 py-2 text-right text-amber-600/70">{fmtUsd(subExternos.ticketProm)}</td>
                  <td className="px-4 py-2 text-right text-emerald-600 font-semibold">{fmtUsd(subExternos.comision)}</td>
                  <td className="px-4 py-2"></td>
                </tr>
              </>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-100/80 font-bold">
              <td className="px-4 py-3 text-slate-400"></td>
              <td className="px-4 py-3 text-slate-800 font-bold">TOTAL GENERAL</td>
              <td className="px-4 py-3 text-center text-slate-800 font-black">{totalGlobal.despachos}</td>
              <td className="px-4 py-3 text-right font-black text-slate-900">{fmtUsd(totalGlobal.totalUsd)}</td>
              <td className="px-4 py-3 text-right text-slate-500 font-semibold">
                {fmtUsd(totalGlobal.ticketProm)}
              </td>
              <td className="px-4 py-3 text-right text-emerald-700 font-black">
                {fmtUsd(totalGlobal.comision)}
              </td>
              <td className="px-4 py-3"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden divide-y divide-slate-100">
        {/* 1. ASESORES INTERNOS MÓVIL */}
        {internos.length > 0 && (
          <div>
            <div className="bg-slate-50 px-4 py-2 flex items-center gap-1.5 text-[10px] font-extrabold text-slate-500 uppercase">
              <Users size={12} className="text-slate-400" />
              Vendedores Internos
            </div>
            {internos.map((v, i) => {
              return (
                <div key={v.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400 w-5">{i + 1}</span>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0"
                        style={{ background: v.color }}>
                        {v.nombre[0].toUpperCase()}
                      </div>
                      <span className="text-sm font-bold text-slate-700">{v.nombre}</span>
                    </div>
                    <span className="text-sm font-black text-slate-800">{fmtUsd(v.totalUsd)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 ml-12">
                    <span>{v.despachos} despacho{v.despachos !== 1 ? 's' : ''}</span>
                    <span>Comisión: <span className="text-emerald-600 font-semibold">{fmtUsd(v.comision)}</span></span>
                  </div>
                  <div className="ml-12"><Barra pct={(v.totalUsd / maxUsd) * 100} color={v.color} /></div>
                </div>
              )
            })}
            <div className="bg-slate-50/50 px-4 py-2 border-t border-slate-100 flex justify-between text-xs font-bold text-slate-500">
              <span>SUBTOTAL INTERNOS ({internos.length})</span>
              <span>{fmtUsd(subInternos.totalUsd)}</span>
            </div>
          </div>
        )}

        {/* 2. VENDEDORES EXTERNOS MÓVIL */}
        {externos.length > 0 && (
          <div className="border-t border-slate-200">
            <div className="bg-amber-50/50 px-4 py-2 flex items-center gap-1.5 text-[10px] font-extrabold text-amber-700 uppercase">
              <Briefcase size={12} className="text-amber-600" />
              Vendedores Externos
            </div>
            {externos.map((v, i) => {
              return (
                <div key={v.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400 w-5">{i + 1}</span>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0 shadow-inner"
                        style={{ background: '#D97706' }}>
                        {v.nombre[0].toUpperCase()}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-700">{v.nombre}</span>
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded px-1 py-0.2 w-fit">
                          💼 Externo (+{v.markup_pct}%)
                        </span>
                      </div>
                    </div>
                    <span className="text-sm font-black text-slate-800">{fmtUsd(v.totalUsd)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 ml-12">
                    <span>{v.despachos} despacho{v.despachos !== 1 ? 's' : ''}</span>
                    <span>Comisión: <span className="text-emerald-600 font-semibold">{fmtUsd(v.comision)}</span></span>
                  </div>
                  <div className="ml-12"><Barra pct={(v.totalUsd / maxUsd) * 100} color="#D97706" /></div>
                </div>
              )
            })}
            <div className="bg-amber-50/10 px-4 py-2 border-t border-amber-100 flex justify-between text-xs font-bold text-amber-800">
              <span>SUBTOTAL EXTERNOS ({externos.length})</span>
              <span>{fmtUsd(subExternos.totalUsd)}</span>
            </div>
          </div>
        )}

        {/* TOTAL GLOBAL MÓVIL */}
        <div className="bg-slate-100 px-4 py-3.5 space-y-2 border-t-2 border-slate-200">
          <div className="flex items-center justify-between font-extrabold text-sm">
            <span className="text-slate-800">TOTAL GLOBAL</span>
            <span className="text-slate-900 font-black">{fmtUsd(totalGlobal.totalUsd)}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 ml-1">
            <span>{totalGlobal.despachos} despacho{totalGlobal.despachos !== 1 ? 's' : ''}</span>
            <span>Comisiones: <span className="text-emerald-700 font-black">{fmtUsd(totalGlobal.comision)}</span></span>
          </div>
        </div>
      </div>
    </div>
  )
}
