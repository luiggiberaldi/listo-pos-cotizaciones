import React from 'react';
import { Store, Printer, Coins, Check } from 'lucide-react';
import { SectionCard, Toggle } from '../../SettingsShared';

export default function SettingsTabNegocio({
    businessName, setBusinessName,
    businessRif, setBusinessRif,
    paperWidth, setPaperWidth,
    copEnabled, setCopEnabled,
    autoCopEnabled, setAutoCopEnabled,
    tasaCopManual, setTasaCopManual,
    calculatedTasaCop,
    handleSaveBusinessData,
    forceHeartbeat,
    showToast,
    triggerHaptic,
}) {
    return (
        <>
            {/* Mi Negocio */}
            <SectionCard icon={Store} title="Mi Negocio" subtitle="Datos que aparecen en tickets" iconColor="text-indigo-500">
                <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Nombre del Negocio</label>
                    <input
                        type="text"
                        placeholder="Ej: Mi Bodega C.A."
                        value={businessName}
                        onChange={e => setBusinessName(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all"
                    />
                </div>
                <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">RIF o Documento</label>
                    <input
                        type="text"
                        placeholder="Ej: J-12345678"
                        value={businessRif}
                        onChange={e => setBusinessRif(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all"
                    />
                </div>
                <button
                    onClick={handleSaveBusinessData}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors active:scale-[0.98]"
                >
                    <Check size={16} /> Guardar
                </button>
            </SectionCard>

            {/* Impresora */}
            <SectionCard icon={Printer} title="Impresora" subtitle="Configuracion de papel termico" iconColor="text-violet-500">
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Ancho de Papel</label>
                <div className="grid grid-cols-2 gap-2">
                    {[{ val: '58', label: '58 mm (Pequena)' }, { val: '80', label: '80 mm (Estandar)' }].map(opt => (
                        <button
                            key={opt.val}
                            onClick={() => { setPaperWidth(opt.val); localStorage.setItem('printer_paper_width', opt.val); triggerHaptic?.(); }}
                            className={`py-2.5 px-3 text-xs font-bold rounded-xl transition-all border ${paperWidth === opt.val
                                ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-400 text-violet-700 dark:text-violet-300 shadow-sm'
                                : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </SectionCard>

            {/* Monedas COP */}
            <SectionCard icon={Coins} title="Peso Colombiano (COP)" subtitle="Habilitar pagos y calculos en COP" iconColor="text-amber-500">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Habilitar COP</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Pagos y calculos rapidos</p>
                    </div>
                    <Toggle
                        enabled={copEnabled}
                        color="amber"
                        onChange={() => {
                            const newVal = !copEnabled;
                            setCopEnabled(newVal);
                            localStorage.setItem('cop_enabled', newVal.toString());
                            forceHeartbeat();
                            showToast(newVal ? 'COP Habilitado' : 'COP Deshabilitado', 'success');
                            triggerHaptic?.();
                        }}
                    />
                </div>
                {copEnabled && (
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">Calcular Automaticamente</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">TRM Oficial + Binance USDT</p>
                            </div>
                            <Toggle
                                enabled={autoCopEnabled}
                                color="amber"
                                onChange={() => {
                                    const newVal = !autoCopEnabled;
                                    setAutoCopEnabled(newVal);
                                    localStorage.setItem('auto_cop_enabled', newVal.toString());
                                    triggerHaptic?.();
                                }}
                            />
                        </div>
                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">
                                {autoCopEnabled ? 'Tasa Actual Calculada' : 'Tasa Manual (COP por 1 USD)'}
                            </label>
                            <input
                                type="number"
                                placeholder="Ej: 4150"
                                value={autoCopEnabled ? (calculatedTasaCop > 0 ? calculatedTasaCop.toFixed(2) : '') : tasaCopManual}
                                readOnly={autoCopEnabled}
                                onChange={e => {
                                    if (!autoCopEnabled) {
                                        setTasaCopManual(e.target.value);
                                        localStorage.setItem('tasa_cop', e.target.value);
                                    }
                                }}
                                className={`w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/30 ${autoCopEnabled ? 'text-slate-400 cursor-not-allowed bg-slate-100 dark:bg-slate-800/80' : 'text-amber-600 dark:text-amber-500'}`}
                            />
                            {autoCopEnabled && (
                                <p className="text-[9px] text-amber-600/70 dark:text-amber-400/70 mt-1.5 font-medium">Se actualiza automaticamente cada 30 segundos.</p>
                            )}
                        </div>
                    </div>
                )}
            </SectionCard>
        </>
    );
}

