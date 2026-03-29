import React from 'react';
import {
    Database, Users, Lock, AlertTriangle, Mail, Eye, EyeOff,
    ShieldCheck, Fingerprint, Rocket, Clock
} from 'lucide-react';
import { SectionCard, Toggle } from '../../SettingsShared';
import UsersManager from '../UsersManager';
import { supabaseCloud } from '../../../config/supabaseCloud';

// ─── CONTROL DE PRÓXIMAMENTE ────────────────────────────────────────────────
// Cambiar a false cuando la funcionalidad esté completa y lista para clientes
const SHOW_COMING_SOON = true;
// ────────────────────────────────────────────────────────────────────────────

function ComingSoonOverlay() {
    return (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur-sm rounded-2xl">
            <div className="flex flex-col items-center gap-4 px-8 text-center max-w-xs">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-xl shadow-indigo-500/30">
                    <Rocket size={36} className="text-white" strokeWidth={1.5} />
                </div>
                <div>
                    <h2 className="text-xl font-black text-slate-800 dark:text-white tracking-tight">Próximamente</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                        Esta sección está en desarrollo y estará disponible muy pronto.
                    </p>
                </div>
                <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-full px-4 py-2">
                    <Clock size={13} className="text-indigo-500" />
                    <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 tracking-wide uppercase">En desarrollo</span>
                </div>
            </div>
        </div>
    );
}

export default function SettingsTabUsuarios({
    isCloudConfigured, adminEmail,
    requireLogin, setRequireLogin,
    autoLockMinutes, setAutoLockMinutes,
    importStatus, statusMessage,
    isCloudLogin, setIsCloudLogin,
    inputPhone, setInputPhone,
    inputEmail, setInputEmail, emailError, setEmailError,
    inputPassword, setInputPassword, passwordError, setPasswordError,
    showPassword, setShowPassword,
    isRecoveringPassword, setIsRecoveringPassword,
    handleSaveCloudAccount, handleResetPasswordRequest,
    setAdminCredentials, showToast, triggerHaptic,
}) {
    return (
        <div className="relative">
            {SHOW_COMING_SOON && <ComingSoonOverlay />}
            {isCloudConfigured && (
                <SectionCard icon={Users} title="Usuarios y Roles" subtitle="Gestiona quien opera la app" iconColor="text-indigo-500">
                    <UsersManager triggerHaptic={triggerHaptic} />
                </SectionCard>
            )}

            <SectionCard icon={Lock} title="Seguridad (ADMIN)" subtitle="Evitar accesos no autorizados" iconColor="text-rose-500">

                {/* Formulario Correo Nube */}
                {!isCloudConfigured && (
                    <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/30 rounded-2xl animate-in fade-in zoom-in-95">
                        <div className="flex items-start gap-2.5 mb-3">
                            <AlertTriangle size={16} className="text-rose-500 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-xs font-bold text-rose-700 dark:text-rose-400">Protección Requerida</p>
                                <p className="text-[10px] text-rose-600/80 dark:text-rose-400/80 leading-relaxed mt-0.5">
                                    Para crear nuevos usuarios, modificar las alertas de seguridad o deshabilitar el PIN de la aplicación, debes registrar primero un correo y contraseña de recuperación.
                                </p>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 border border-rose-200/60 dark:border-rose-900/40 rounded-xl p-4 mt-3 shadow-inner">
                            {/* Tabs Login/Registro */}
                            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 mb-4">
                                <button
                                    onClick={() => setIsCloudLogin(true)}
                                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${isCloudLogin ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    Entrar
                                </button>
                                <button
                                    onClick={() => setIsCloudLogin(false)}
                                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${!isCloudLogin ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    Registrarse
                                </button>
                            </div>

                            {importStatus === 'awaiting_email_confirmation' ? (
                                <div className="text-center py-6 px-4 animate-in fade-in zoom-in">
                                    <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <Mail size={32} className="text-indigo-500" />
                                    </div>
                                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">¡Revisa tu correo!</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
                                        Hemos enviado un enlace de confirmación a <strong className="text-slate-700 dark:text-slate-300">{inputEmail}</strong>.
                                        Por favor haz clic en él para verificar tu identidad y luego regresa aquí para Iniciar Sesión.
                                    </p>
                                    <button
                                        onClick={() => { setIsCloudLogin(true); }}
                                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors active:scale-95"
                                    >
                                        Ya lo confirmé, Iniciar Sesión
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {!isCloudLogin && (
                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Teléfono Móvil</label>
                                            <div className="relative">
                                                <input
                                                    type="tel"
                                                    placeholder="Ej: 0414..."
                                                    value={inputPhone}
                                                    onChange={e => setInputPhone(e.target.value)}
                                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-10 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/30 outline-none"
                                                />
                                                <Fingerprint size={16} className="absolute left-3.5 top-3 text-slate-400" />
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-1">
                                        <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Correo Electrónico</label>
                                        <div className="relative">
                                            <input
                                                type="email"
                                                placeholder="tu@correo.com"
                                                value={inputEmail}
                                                onChange={e => { setInputEmail(e.target.value); setEmailError(''); }}
                                                className={`w-full bg-slate-50 dark:bg-slate-950 border ${emailError ? 'border-red-400' : 'border-slate-200 dark:border-slate-800'} rounded-xl pl-10 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/30 outline-none transition-all`}
                                            />
                                            <Mail size={16} className={`absolute left-3.5 top-3 ${emailError ? 'text-red-400' : 'text-slate-400'}`} />
                                        </div>
                                        {emailError && <p className="text-[10px] text-red-500 mt-1 ml-1 font-medium">{emailError}</p>}
                                    </div>

                                    {!isRecoveringPassword && (
                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Contraseña</label>
                                            <div className="relative">
                                                <input
                                                    type={showPassword ? 'text' : 'password'}
                                                    placeholder="Mínimo 6 caracteres"
                                                    value={inputPassword}
                                                    onChange={e => { setInputPassword(e.target.value); setPasswordError(''); }}
                                                    className={`w-full bg-slate-50 dark:bg-slate-950 border ${passwordError ? 'border-red-400' : 'border-slate-200 dark:border-slate-800'} rounded-xl pl-10 pr-10 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/30 outline-none transition-all`}
                                                />
                                                <Lock size={16} className={`absolute left-3.5 top-3 ${passwordError ? 'text-red-400' : 'text-slate-400'}`} />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowPassword(!showPassword)}
                                                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none"
                                                >
                                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                                </button>
                                            </div>
                                            {passwordError && <p className="text-[10px] text-red-500 mt-1 ml-1 font-medium">{passwordError}</p>}
                                        </div>
                                    )}

                                    {importStatus === 'error' && (
                                        <div className="p-2.5 mt-2 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-lg flex items-center gap-2">
                                            <AlertTriangle size={14} className="text-red-500 shrink-0" />
                                            <p className="text-[10px] text-red-600 dark:text-red-400 font-medium">{statusMessage}</p>
                                        </div>
                                    )}

                                    <button
                                        onClick={isRecoveringPassword ? handleResetPasswordRequest : handleSaveCloudAccount}
                                        disabled={importStatus === 'loading'}
                                        className="w-full mt-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 dark:disabled:bg-indigo-800 text-white text-sm font-bold rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
                                    >
                                        {importStatus === 'loading'
                                            ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            : <ShieldCheck size={18} />
                                        }
                                        {importStatus === 'loading' ? 'Procesando...' : (
                                            isRecoveringPassword ? 'Enviar enlace de recuperación' :
                                            (isCloudLogin ? 'Entrar y Sincronizar' : 'Crear Cuenta Segura')
                                        )}
                                    </button>

                                    <div className="flex flex-col items-center mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                                        {isCloudLogin && !isRecoveringPassword && (
                                            <button
                                                type="button"
                                                onClick={() => { setIsRecoveringPassword(true); setEmailError(''); setPasswordError(''); }}
                                                className="text-[11px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline mb-2"
                                            >
                                                ¿Olvidaste tu contraseña?
                                            </button>
                                        )}
                                        {isRecoveringPassword && (
                                            <button
                                                type="button"
                                                onClick={() => { setIsRecoveringPassword(false); setEmailError(''); }}
                                                className="text-[11px] text-slate-500 font-bold hover:underline mb-2"
                                            >
                                                Volver a Iniciar Sesión
                                            </button>
                                        )}
                                        {!isCloudLogin && !isRecoveringPassword && (
                                            <p className="text-[9px] text-center text-slate-400 dark:text-slate-500 leading-relaxed">
                                                Al registrarte, enviaremos un correo de validación. Tu información será encriptada y quedará lista para la próxima <strong>Estación Maestra</strong>.
                                            </p>
                                        )}
                                        {isRecoveringPassword && (
                                            <p className="text-[9px] text-center text-slate-400 dark:text-slate-500 leading-relaxed max-w-[200px]">
                                                Ingresa el correo de tu cuenta. Te enviaremos un mensaje con un enlace para crear una contraseña nueva.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {isCloudConfigured && (
                    <div className="mb-5 p-3.5 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30 rounded-2xl flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/40 rounded-full flex items-center justify-center">
                                <Database size={20} className="text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Sincronización Activa</p>
                                <p className="text-[10px] text-slate-500">{adminEmail}</p>
                            </div>
                        </div>
                        <button
                            onClick={async () => {
                                if (window.confirm('¿Seguro que deseas cerrar la sesión en la nube?')) {
                                    setAdminCredentials('', '');
                                    if (supabaseCloud) await supabaseCloud.auth.signOut();
                                    showToast('Sesión de nube cerrada', 'success');
                                }
                            }}
                            className="px-3 py-1.5 bg-white dark:bg-slate-800 text-red-500 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-red-50 dark:hover:bg-red-900/20 active:scale-95 transition-all"
                        >
                            Cerrar Sesión
                        </button>
                    </div>
                )}

                {/* Login Opcional */}
                <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-800 pb-4 mt-6">
                    <div>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Pedir PIN al iniciar</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Si se desactiva, entrará directo como Administrador.</p>
                    </div>
                    <Toggle
                        enabled={requireLogin}
                        color="rose"
                        onChange={() => {
                            const newVal = !requireLogin;
                            if (setRequireLogin) setRequireLogin(newVal);
                            triggerHaptic?.();
                            showToast(newVal ? 'PIN activado para inicio' : 'Acceso directo activado', 'success');
                        }}
                    />
                </div>

                {/* Bloqueo por inactividad — solo visible si PIN está activo */}
                {requireLogin && (
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Bloqueo Automático</label>
                        <p className="text-[10px] text-slate-400 mb-3">Tu sesión se bloqueará tras estos minutos de inactividad.</p>
                        <div className="grid grid-cols-4 gap-2">
                            {[
                                { val: '1', label: '1m' },
                                { val: '3', label: '3m' },
                                { val: '5', label: '5m' },
                                { val: '10', label: '10m' }
                            ].map(opt => (
                                <button
                                    key={opt.val}
                                    onClick={() => {
                                        setAutoLockMinutes(opt.val);
                                        localStorage.setItem('admin_auto_lock_minutes', opt.val);
                                        triggerHaptic?.();
                                    }}
                                    className={`py-2 text-xs font-bold rounded-xl transition-all border ${autoLockMinutes === opt.val
                                        ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-400 text-rose-700 dark:text-rose-300 shadow-sm'
                                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </SectionCard>
        </div>
    );
}

