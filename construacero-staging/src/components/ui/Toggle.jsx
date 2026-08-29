// src/components/ui/Toggle.jsx
// Switch reutilizable — extraído del inline de ConfiguracionView.
export default function Toggle({ checked, onChange, disabled, color = 'amber', label }) {
  const colorOn = color === 'amber' ? 'bg-amber-500 focus:ring-amber-500'
    : color === 'indigo' ? 'bg-indigo-500 focus:ring-indigo-500'
    : color === 'emerald' ? 'bg-emerald-500 focus:ring-emerald-500'
    : color === 'sky' ? 'bg-sky-500 focus:ring-sky-500'
    : 'bg-primary focus:ring-primary'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${
        checked ? colorOn : 'bg-slate-300'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
      {label && <span className="sr-only">{label}</span>}
    </button>
  )
}
