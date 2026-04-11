import React, { useState, useEffect } from 'react';
import {
    ShieldCheck, Smartphone, Trash2, Clock,
    RefreshCw, Wifi, Zap, Crown, AlertTriangle,
    Calendar, Users, Pencil, Check, X
} from 'lucide-react';
import { supabaseCloud } from '../../../config/supabaseCloud';
import { useConfirm } from '../../../hooks/useConfirm.jsx';
import { showToast } from '../../Toast';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return 'Justo ahora';
    if (mins < 60) return `Hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Hace ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `Hace ${days}d`;
}

// Devuelve el estado de sesión basado en last_seen
function sessionStatus(lastSeen) {
    if (!lastSeen) return 'offline';
    const mins = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000);
    if (mins < 5) return 'active';
    if (mins < 30) return 'recent';
    return 'offline';
}

const SESSION_DOT = {
    active: 'bg-emerald-400',
    recent: 'bg-amber-400',
    offline: 'bg-slate-300 dark:bg-slate-600',
};

const SESSION_LABEL = {
    active: 'Activo ahora',
    recent: 'Reciente',
    offline: 'Sin actividad',
};

// ─── Loading skeleton ──────────────────────────────────────────────────────────
function LicenseSkeleton() {
    return (
        <div className="animate-pulse space-y-4 p-4">
            <div className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />
            <div className="h-4 w-2/3 rounded-full bg-slate-200 dark:bg-slate-800" />
            <div className="h-16 rounded-2xl bg-slate-200 dark:bg-slate-800" />
            <div className="h-16 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        </div>
    );
}

// ─── Main viewer ──────────────────────────────────────────────────────────────
function CloudLicenseViewer({ adminEmail }) {
    const [devices, setDevices] = useState([]);
    const [license, setLicense] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    // Inline rename state
    const [editingId, setEditingId] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [saving, setSaving] = useState(false);
    // ID del dispositivo actual
    const currentDeviceId = localStorage.getItem('pda_device_id') || '';
    const confirm = useConfirm();

    const loadData = async (silent = false) => {
        if (!silent) setLoading(true);
        else setRefreshing(true);

        const [devRes, licRes] = await Promise.all([
            supabaseCloud.from('account_devices').select('*').eq('email', adminEmail).order('last_seen', { ascending: false }),
            supabaseCloud.from('cloud_licenses').select('*').eq('email', adminEmail).maybeSingle()
        ]);
        if (!devRes.error && devRes.data) {
            // Ordenar: activos primero, luego recientes, luego offline
            const statusOrder = { active: 0, recent: 1, offline: 2 };
            const sorted = [...devRes.data].sort((a, b) =>
                statusOrder[sessionStatus(a.last_seen)] - statusOrder[sessionStatus(b.last_seen)]
            );
            setDevices(sorted);
        }
        if (!licRes.error && licRes.data) setLicense(licRes.data);

        if (!silent) setLoading(false);
        else setRefreshing(false);
    };

    useEffect(() => {
        if (adminEmail) loadData();
    }, [adminEmail]);

    const handleRemoveDevice = async (deviceId, alias) => {
        const ok = await confirm({
            title: 'Desvincular dispositivo',
            message: `"${alias}" perderá acceso a tu cuenta inmediatamente.`,
            confirmText: 'Desvincular',
            cancelText: 'Cancelar',
            variant: 'unlink',
        });
        if (!ok) return;
        const { error } = await supabaseCloud
            .from('account_devices')
            .delete()
            .eq('email', adminEmail)
            .eq('device_id', deviceId);

        if (error) showToast('Error al desvincular', 'error');
        else { showToast('Dispositivo desvinculado', 'success'); loadData(true); }
    };

    const handleStartRename = (d) => {
        setEditingId(d.device_id);
        setRenameValue(d.device_alias || '');
    };

    const handleCancelRename = () => {
        setEditingId(null);
        setRenameValue('');
    };

    const handleSaveRename = async (deviceId) => {
        const newAlias = renameValue.trim();
        if (!newAlias) { showToast('El nombre no puede estar vacío', 'error'); return; }
        setSaving(true);
        const { error } = await supabaseCloud
            .from('account_devices')
            .update({ device_alias: newAlias })
            .eq('email', adminEmail)
            .eq('device_id', deviceId);

        if (error) {
            showToast('Error al guardar el nombre', 'error');
        } else {
            // Si es el dispositivo actual, actualizar localStorage también
            if (deviceId === currentDeviceId) {
                localStorage.setItem('pda_device_alias', newAlias);
            }
            showToast('Nombre actualizado', 'success');
            setEditingId(null);
            loadData(true);
        }
        setSaving(false);
    };

    if (loading) return <LicenseSkeleton />;

    if (!license) return (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <ShieldCheck size={28} className="text-slate-400" />
            </div>
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Sin licencia activa</p>
            <p className="text-xs text-slate-400">No hay una licencia asociada a esta cuenta.</p>
        </div>
    );

    const isPermanent = license.license_type === 'permanent';
    let daysDiff = 0;
    if (license.valid_until) {
        daysDiff = Math.ceil((new Date(license.valid_until) - new Date()) / 86400000);
    } else {
        daysDiff = license.days_remaining || 0;
    }
    const daysLeft = daysDiff > 0 ? daysDiff : 0;
    const isExpired = !isPermanent && daysLeft === 0;
    const isWarning = !isPermanent && !isExpired && daysLeft <= 7;

    // Visual config by state
    const config = isExpired
        ? {
            gradient: 'from-rose-500 to-rose-700',
            gradientSubtle: 'from-rose-50 to-rose-100/50 dark:from-rose-950/60 dark:to-rose-900/30',
            border: 'border-rose-200 dark:border-rose-800/60',
            badge: 'bg-rose-500 text-white',
            badgeText: 'VENCIDA',
            icon: AlertTriangle,
            iconColor: 'text-rose-500',
            accentText: 'text-rose-600 dark:text-rose-400',
            barColor: 'bg-rose-500',
        }
        : isPermanent
        ? {
            gradient: 'from-amber-500 to-orange-500',
            gradientSubtle: 'from-amber-50 to-orange-50/50 dark:from-amber-950/60 dark:to-orange-900/30',
            border: 'border-amber-200 dark:border-amber-800/60',
            badge: 'bg-amber-500 text-white',
            badgeText: 'LIFETIME',
            icon: Crown,
            iconColor: 'text-amber-500',
            accentText: 'text-amber-600 dark:text-amber-400',
            barColor: 'bg-amber-500',
        }
        : isWarning
        ? {
            gradient: 'from-orange-500 to-amber-400',
            gradientSubtle: 'from-orange-50 to-amber-50/50 dark:from-orange-950/60 dark:to-amber-900/30',
            border: 'border-orange-200 dark:border-orange-800/60',
            badge: 'bg-orange-500 text-white',
            badgeText: 'POR VENCER',
            icon: Clock,
            iconColor: 'text-orange-500',
            accentText: 'text-orange-600 dark:text-orange-400',
            barColor: 'bg-orange-500',
        }
        : {
            gradient: 'from-indigo-500 to-violet-600',
            gradientSubtle: 'from-indigo-50 to-violet-50/50 dark:from-indigo-950/60 dark:to-violet-900/30',
            border: 'border-indigo-200 dark:border-indigo-800/60',
            badge: 'bg-indigo-500 text-white',
            badgeText: 'ACTIVA',
            icon: Zap,
            iconColor: 'text-indigo-500',
            accentText: 'text-indigo-600 dark:text-indigo-400',
            barColor: 'bg-indigo-500',
        };

    const StatusIcon = config.icon;
    const deviceRatio = license.max_devices > 0 ? (devices.length / license.max_devices) * 100 : 0;
    const deviceBarColor = deviceRatio >= 100 ? 'bg-rose-500' : deviceRatio >= 80 ? 'bg-amber-500' : config.barColor;

    return (
        <div className="space-y-3 pb-2">

            {/* ── Hero status card ── */}
            <div className={`relative overflow-hidden rounded-2xl border ${config.border} bg-gradient-to-br ${config.gradientSubtle}`}>

                {/* Background decoration */}
                <div className={`absolute top-0 right-0 w-32 h-32 -mr-10 -mt-10 rounded-full bg-gradient-to-br ${config.gradient} opacity-10 blur-2xl pointer-events-none`} />

                <div className="relative p-4">
                    {/* Header row */}
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${config.gradient} flex items-center justify-center shadow-lg`}>
                                <StatusIcon size={18} className="text-white" strokeWidth={2.5} />
                            </div>
                            <div>
                                <p className="text-xs font-black text-slate-700 dark:text-slate-200 capitalize">
                                    {license.business_name || `Plan ${license.plan_tier}`}
                                </p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400">{adminEmail}</p>
                            </div>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black tracking-widest uppercase shadow-sm ${config.badge}`}>
                            {config.badgeText}
                        </span>
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 gap-2.5">
                        {/* Devices */}
                        <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl p-3 border border-white/80 dark:border-slate-700/50">
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <Users size={11} className="text-slate-400" />
                                <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Dispositivos</span>
                            </div>
                            <div className="flex items-baseline gap-1">
                                <span className={`text-2xl font-black ${devices.length >= license.max_devices ? 'text-rose-500' : 'text-slate-800 dark:text-white'}`}>
                                    {devices.length}
                                </span>
                                <span className="text-sm text-slate-400 font-bold">/ {license.max_devices}</span>
                            </div>
                            <div className="mt-2 h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-700 ${deviceBarColor}`}
                                    style={{ width: `${Math.min(deviceRatio, 100)}%` }}
                                />
                            </div>
                        </div>

                        {/* Time */}
                        <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl p-3 border border-white/80 dark:border-slate-700/50">
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <Calendar size={11} className="text-slate-400" />
                                <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">
                                    {isPermanent ? 'Vigencia' : 'Días rest.'}
                                </span>
                            </div>
                            {isPermanent ? (
                                <div className="flex items-center gap-1.5 mt-1">
                                    <Crown size={22} className="text-amber-500" strokeWidth={2.5} />
                                    <span className="text-sm font-black text-amber-600 dark:text-amber-400">Lifetime</span>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-baseline gap-1">
                                        <span className={`text-2xl font-black ${isExpired ? 'text-rose-500' : isWarning ? 'text-orange-500' : 'text-slate-800 dark:text-white'}`}>
                                            {daysLeft}
                                        </span>
                                        <span className="text-sm text-slate-400 font-bold">días</span>
                                    </div>
                                    <p className="text-[9px] text-slate-400 mt-1 font-medium">
                                        Corte: {license.valid_until
                                            ? new Date(license.valid_until).toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric' })
                                            : '—'}
                                    </p>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Warning banner */}
                    {(isExpired || isWarning) && (
                        <div className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold ${isExpired ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'bg-orange-500/10 text-orange-600 dark:text-orange-400'}`}>
                            <AlertTriangle size={13} />
                            {isExpired
                                ? 'Tu licencia ha vencido. Contacta soporte para renovar.'
                                : `Tu licencia vence en ${daysLeft} días. Renueva pronto.`}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Devices section ── */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
                {/* Section header */}
                {(() => {
                    const activeCount = devices.filter(d => sessionStatus(d.last_seen) === 'active').length;
                    return (
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2">
                                <Wifi size={13} className="text-indigo-500" />
                                <span className="text-[10px] uppercase font-black text-slate-500 dark:text-slate-400 tracking-widest">
                                    Equipos con sesión
                                </span>
                                <span className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 text-[9px] font-black rounded-md">
                                    {devices.length}
                                </span>
                                {activeCount > 0 && (
                                    <span className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[9px] font-black rounded-md">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                                        {activeCount} activo{activeCount !== 1 ? 's' : ''}
                                    </span>
                                )}
                            </div>
                            <button
                                onClick={() => loadData(true)}
                                disabled={refreshing}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all active:scale-90"
                                title="Actualizar"
                            >
                                <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    );
                })()}

                {/* Device list */}
                {devices.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                        <Smartphone size={28} className="text-slate-300 dark:text-slate-600" />
                        <p className="text-xs text-slate-400">No hay equipos registrados</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-50 dark:divide-slate-800 max-h-[280px] overflow-y-auto">
                        {devices.map((d, i) => {
                            const isCurrent = d.device_id === currentDeviceId;
                            const isEditing = editingId === d.device_id;
                            const status = sessionStatus(d.last_seen);
                            const canUnlink = devices.length > 1;
                            return (
                                <div key={d.device_id} className={`flex items-center justify-between px-4 py-3 group transition-colors ${isCurrent ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className="relative shrink-0">
                                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isCurrent ? 'bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md shadow-indigo-500/30' : 'bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-900/50 dark:to-violet-900/50'}`}>
                                                <Smartphone size={16} className={isCurrent ? 'text-white' : 'text-indigo-500'} />
                                            </div>
                                            <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900 ${SESSION_DOT[status]} ${status === 'active' ? 'animate-pulse' : ''}`} title={SESSION_LABEL[status]} />
                                        </div>

                                        <div className="min-w-0 flex-1 mr-2">
                                            {isEditing ? (
                                                // ── Input inline de edición ──
                                                <div className="flex items-center gap-1.5">
                                                    <input
                                                        autoFocus
                                                        type="text"
                                                        value={renameValue}
                                                        onChange={e => setRenameValue(e.target.value)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') handleSaveRename(d.device_id);
                                                            if (e.key === 'Escape') handleCancelRename();
                                                        }}
                                                        maxLength={30}
                                                        className="flex-1 min-w-0 px-2 py-1 text-xs font-bold bg-white dark:bg-slate-800 border-2 border-indigo-400 dark:border-indigo-600 rounded-lg outline-none text-slate-800 dark:text-white shadow-sm"
                                                        placeholder="Nombre del equipo"
                                                    />
                                                    <button
                                                        onClick={() => handleSaveRename(d.device_id)}
                                                        disabled={saving}
                                                        className="p-1.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-colors active:scale-90 shrink-0"
                                                        title="Guardar"
                                                    >
                                                        <Check size={12} />
                                                    </button>
                                                    <button
                                                        onClick={handleCancelRename}
                                                        className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-90 shrink-0"
                                                        title="Cancelar"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            ) : (
                                                // ── Vista normal ──
                                                <>
                                                    <div className="flex items-center gap-1.5">
                                                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                                            {d.device_alias || `Dispositivo ${i + 1}`}
                                                        </p>
                                                        {isCurrent && (
                                                            <span className="shrink-0 px-1.5 py-0.5 bg-indigo-500 text-white text-[8px] font-black rounded uppercase tracking-wider">Este equipo</span>
                                                        )}
                                                    </div>
                                                    <p className="text-[9px] text-slate-400 mt-0.5">{timeAgo(d.last_seen)}</p>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Actions: edit (current only) + unlink (solo si hay más de 1 dispositivo) */}
                                    {!isEditing && (
                                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {isCurrent && (
                                                <button
                                                    onClick={() => handleStartRename(d)}
                                                    className="p-2 rounded-xl text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all active:scale-90"
                                                    title="Renombrar"
                                                >
                                                    <Pencil size={13} />
                                                </button>
                                            )}
                                            {canUnlink && (
                                                <button
                                                    onClick={() => handleRemoveDevice(d.device_id, d.device_alias || `Dispositivo ${i + 1}`)}
                                                    className="p-2 rounded-xl text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all active:scale-90"
                                                    title="Desvincular"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer */}
            <p className="text-[9px] text-center text-slate-400 pb-1">
                ¿Necesitas ampliar tu plan?{' '}
                <span className="text-indigo-500 font-bold">Contacta soporte</span>
            </p>
        </div>
    );
}

// ─── Tab export ───────────────────────────────────────────────────────────────
export default function SettingsTabLicencia({ isCloudConfigured, adminEmail }) {
    if (!isCloudConfigured || !adminEmail) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center px-8">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-900/40 dark:to-violet-900/40 flex items-center justify-center shadow-inner">
                    <ShieldCheck size={32} className="text-indigo-400" />
                </div>
                <div>
                    <p className="text-sm font-black text-slate-700 dark:text-slate-200">Sin cuenta cloud</p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        Conecta tu cuenta en la sección de <strong>Usuarios</strong> para visualizar tu licencia.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="px-4 pt-4">
            <CloudLicenseViewer adminEmail={adminEmail} />
        </div>
    );
}
