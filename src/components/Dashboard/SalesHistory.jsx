import React, { useState } from 'react';
import { Clock, Send, Ban, ChevronDown, ChevronUp, Trash2, Shuffle, Recycle, Receipt, Printer } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';
import { getPaymentLabel, getPaymentMethod, PAYMENT_ICONS, getPaymentIcon, toTitleCase } from '../../config/paymentMethods';
import EmptyState from '../EmptyState';

export default function SalesHistory({
    sales,
    recentSales,
    bcvRate,
    totalSalesCount,
    onVoidSale,
    onShareWhatsApp,
    onDownloadPDF,
    onOpenDeleteModal,
    onRequestClientForTicket,
    onRecycleSale,
    onPrintTicket
}) {
    const [expandedSaleId, setExpandedSaleId] = useState(null);

    if (recentSales.length === 0) {
        return (
            <div className="mb-20 mt-4">
                <EmptyState
                    icon={Receipt}
                    title="Aún no hay ventas"
                    description="Las ventas recientes aparecerán aquí una vez que comiences a facturar."
                />
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm mb-20">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1">
                    <Clock size={12} /> Últimas 7 Ventas
                </h3>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">{totalSalesCount} histórico</span>
                    <button
                        onClick={onOpenDeleteModal}
                        className="text-slate-300 hover:text-red-500 transition-colors bg-slate-50 hover:bg-red-50 p-1.5 rounded-lg"
                        title="Borrar historial"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>
            <div className="space-y-3">
                {recentSales.map(s => {
                    const d = new Date(s.timestamp);
                    let methodLabel = 'Efectivo';
                    let PayMethodIcon = PAYMENT_ICONS['efectivo_bs'];

                    if (s.payments && s.payments.length === 1) {
                        methodLabel = toTitleCase(s.payments[0].methodLabel);
                        const m = getPaymentMethod(s.payments[0].methodId);
                        if (m) PayMethodIcon = getPaymentIcon(m.id) || m.Icon || null;
                    } else if (s.payments && s.payments.length > 1) {
                        methodLabel = 'Pago Mixto';
                        PayMethodIcon = Shuffle;
                    } else if (s.paymentMethod) {
                        const m = getPaymentMethod(s.paymentMethod);
                        if (m) {
                            methodLabel = toTitleCase(m.label);
                            PayMethodIcon = getPaymentIcon(m.id) || m.Icon || null;
                        }
                    }

                    const isCanceled = s.status === 'ANULADA';
                    const isExpanded = expandedSaleId === s.id;

                    return (
                        <div key={s.id} className={`rounded-xl border transition-all ${isCanceled ? 'bg-red-50/50 border-red-100/50 dark:bg-red-900/10 dark:border-red-900/20' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200/60 dark:border-slate-700/60'} overflow-hidden`}>
                            <div
                                className="flex items-center gap-3 p-3 cursor-pointer select-none active:bg-slate-100 dark:active:bg-slate-800"
                                onClick={() => setExpandedSaleId(isExpanded ? null : s.id)}
                            >
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isCanceled ? 'bg-red-100 opacity-50' : 'bg-white dark:bg-slate-700 shadow-sm'}`}>
                                    {isCanceled ? <Ban size={20} className="text-red-400" /> : (PayMethodIcon ? <PayMethodIcon size={20} className="text-slate-500" /> : <span className="text-xl">💵</span>)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-bold flex items-center gap-1.5 truncate ${isCanceled ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                        {s.customerName || 'Consumidor Final'} {s.tipo === 'VENTA_FIADA' && <span className="text-[9px] bg-amber-100 text-amber-600 px-1 rounded uppercase">Fiado</span>}
                                    </p>
                                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                                        <span>{d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</span> ·
                                        <span>{methodLabel}</span>
                                    </p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className={`text-sm font-black ${isCanceled ? 'text-slate-400' : 'text-slate-800 dark:text-white'}`}>${(s.totalUsd || 0).toFixed(2)}</p>
                                    <div className="flex justify-end mt-0.5">
                                        {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                    </div>
                                </div>
                            </div>

                            {/* Expanded details */}
                            {isExpanded && (
                                <div className="px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-700/50 text-sm animate-in fade-in slide-in-from-top-1">
                                    {s.items && s.items.length > 0 ? (
                                        <div className="space-y-1 mb-3 pt-2">
                                            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Productos ({s.items.length})</p>
                                            {s.items.map((item, i) => (
                                                <div key={i} className={`flex justify-between items-center text-xs ${isCanceled ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-slate-300'}`}>
                                                    <span className="truncate pr-2">{item.isWeight ? `${item.qty.toFixed(3)}kg` : `${item.qty}u`} {item.name}</span>
                                                    <span className="font-medium">${(item.priceUsd * item.qty).toFixed(2)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-400 mb-3 pt-2">Pago de Deudas (Sin productos)</p>
                                    )}

                                    <div className="flex justify-between text-[10px] font-medium text-slate-400 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg p-2 mb-3">
                                        <div>Ref: {formatBs(s.totalBs)} Bs @ {formatBs(s.rate || bcvRate)}</div>
                                        {s.changeUsd > 0 && <div className="text-emerald-500">Vuelto: ${s.changeUsd.toFixed(2)}</div>}
                                    </div>

                                    <div className="flex items-center justify-between gap-2 mt-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (!s.customerName || s.customerName === 'Consumidor Final') {
                                                    onRequestClientForTicket(s);
                                                } else {
                                                    onShareWhatsApp(s);
                                                }
                                            }}
                                            className="flex-1 py-2 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 hover:dark:bg-emerald-900/50 active:scale-95">
                                            <Send size={14} /> Enviar Ticket
                                        </button>
                                        {onDownloadPDF && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onDownloadPDF(s); }}
                                                className="py-2 px-3 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 hover:dark:bg-blue-900/50 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm">
                                                PDF
                                            </button>
                                        )}
                                        {onPrintTicket && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onPrintTicket(s); }}
                                                className="py-2 px-3 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 hover:bg-violet-200 hover:dark:bg-violet-900/50 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95"
                                                title="Imprimir ticket"
                                            >
                                                <Printer size={14} />
                                            </button>
                                        )}

                                        {!isCanceled && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onVoidSale(s); }}
                                                className="py-2 px-3 bg-slate-100 dark:bg-slate-900 text-red-600 dark:text-red-400 hover:bg-red-50 hover:dark:bg-red-900/30 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-800 shadow-sm active:scale-95">
                                                <Ban size={14} /> Anular
                                            </button>
                                        )}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onRecycleSale(s); }}
                                            className="py-2 px-3 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-200 hover:dark:bg-indigo-900/50 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95">
                                            <Recycle size={14} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
