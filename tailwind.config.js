/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {

        // ─────────────────────────────────────────────────────
        // 🎨 CONSTRUACERO CARABOBO — PALETA OFICIAL
        // Inspirada en Instagram de la marca (Azul Marino + Dorado)
        // ─────────────────────────────────────────────────────

        // 1. PRIMARIO — Azul Marino Cobalt (botones, nav activo, foco)
        primary: {
          DEFAULT: '#1A3A8C', // Cobalt — botón principal
          hover:   '#152E73', // hover más profundo
          light:   '#EBF0FF', // fondo suave (badges, highlights)
          focus:   '#93B4F8', // anillo de foco en inputs
          dark:    '#0F2461', // pressed / active state
        },

        // 2. ACENTO DORADO (énfasis, precios, highlights de marca)
        accent: {
          DEFAULT: '#D4A017', // Dorado cálido
          hover:   '#B88B12', // hover dorado oscuro
          light:   '#FEF9E7', // fondo dorado muy suave
          focus:   '#FDE68A', // anillo dorado
          dark:    '#8A6410', // dorado profundo
        },

        // 3. FONDOS DE PANTALLA
        app: {
          light: '#F8FAFC', // Blanco hielo — fondo general (modo claro)
          dark:  '#0C1B3E', // Azul marino profundo — identidad de marca
        },

        // 4. FONDOS DE TARJETAS / MODALES / SIDEBAR
        surface: {
          light: '#FFFFFF',
          dark:  '#111E40', // Azul marino panel
        },

        // 5. TEXTOS
        content: {
          main:      '#1A2744', // Navy oscuro — títulos
          secondary: '#64748B', // Slate-500 — subtítulos
          inverse:   '#F8FAFC', // Texto claro sobre fondos oscuros
        },

        // 6. ESTADOS SEMÁNTICOS
        status: {
          success:   '#10B981',
          successBg: '#D1FAE5',
          danger:    '#F43F5E',
          dangerBg:  '#FFE4E6',
          warning:   '#F59E0B',
          warningBg: '#FEF3C7',
        },

        // 7. BORDES Y SEPARADORES
        border: {
          subtle: '#E2E8F0',
          focus:  '#1A3A8C', // Navy — borde activo en inputs
        },

        // ─────────────────────────────────────────────────────
        // 🔄 ALIASES — Compatibilidad con código existente
        // ─────────────────────────────────────────────────────

        brand: {
          light:   '#EBF0FF',
          DEFAULT: '#1A3A8C',
          dark:    '#0F2461',
        },

        background: {
          light: '#F8FAFC',
          dark:  '#0C1B3E',
        },

        // blue → navy cobalt
        blue: {
          50:  '#EBF0FF',
          100: '#D6E2FF',
          200: '#ADC5FF',
          300: '#85A8FF',
          400: '#5C8AFF',
          500: '#1A3A8C',
          600: '#152E73',
          700: '#0F2461',
          800: '#0A1A4A',
          900: '#060F2F',
          950: '#030820',
        },

        // indigo → navy (compatibilidad)
        indigo: {
          50:  '#EBF0FF',
          100: '#D6E2FF',
          200: '#ADC5FF',
          300: '#85A8FF',
          400: '#5C8AFF',
          500: '#1A3A8C',
          600: '#152E73',
          700: '#0F2461',
          800: '#0A1A4A',
          900: '#060F2F',
          950: '#030820',
        },

        // sky → cobalt
        sky: {
          50:  '#EBF0FF',
          100: '#D6E2FF',
          200: '#ADC5FF',
          300: '#85A8FF',
          400: '#5C8AFF',
          500: '#1A3A8C',
          600: '#152E73',
          700: '#0F2461',
          800: '#0A1A4A',
          900: '#060F2F',
        },

        // purple → navy
        purple: {
          50:  '#EBF0FF',
          100: '#D6E2FF',
          400: '#5C8AFF',
          500: '#1A3A8C',
          600: '#152E73',
          700: '#0F2461',
        },

        // teal → accent gold
        teal: {
          50:  '#FEF9E7',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#D4A017',
          600: '#B88B12',
          700: '#8A6410',
          800: '#5C420A',
          900: '#2E2105',
        },

        // slate (neutros)
        slate: {
          50:  '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
          950: '#020617',
        },

        // emerald — success
        emerald: {
          50:  '#ECFDF5',
          100: '#D1FAE5',
          400: '#34D399',
          500: '#10B981',
          600: '#059669',
          900: '#064E3B',
        },

        // red — danger
        red: {
          50:  '#FFF1F2',
          100: '#FFE4E6',
          400: '#FB7185',
          500: '#F43F5E',
          600: '#E11D48',
          900: '#881337',
        },

        // amber — warning
        amber: {
          50:  '#FFFBEB',
          100: '#FEF3C7',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
          900: '#78350F',
        },

        // rose → danger (compatibilidad)
        rose: {
          50:  '#FFF1F2',
          100: '#FFE4E6',
          400: '#FB7185',
          500: '#F43F5E',
          600: '#E11D48',
        },
      },

      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },

      animation: {
        'fade-in':        'fadeIn 0.3s ease-out',
        'slide-up':       'slideUp 0.4s ease-out',
        'spin-slow':      'spin 1s linear infinite',
        'slide-in-left':  'slideInLeft 0.3s ease-out',
        'slide-out-left': 'slideOutLeft 0.2s ease-in forwards',
      },

      keyframes: {
        fadeIn:       { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp:      { '0%': { transform: 'translateY(10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        slideInLeft:  { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(0)' } },
        slideOutLeft: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-100%)' } },
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        '.font-numbers': {
          'font-variant-numeric': 'tabular-nums',
          'letter-spacing': '-0.02em',
        },
        '.scrollbar-hide': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
        '.custom-scrollbar': {
          '&::-webkit-scrollbar': { width: '4px', height: '4px' },
          '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          '&::-webkit-scrollbar-thumb': { backgroundColor: '#CBD5E1', borderRadius: '2px' },
        },
      })
    },
  ],
}
