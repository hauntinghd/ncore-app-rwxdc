/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        nyptid: {
          50: '#fff8e8',
          100: '#ffe8bf',
          200: '#ffd47e',
          300: '#f3bb52',
          400: '#e39b34',
          500: '#c97621',
          600: '#a7561a',
          700: '#813b16',
          800: '#56250f',
          900: '#2f130a',
        },
        surface: {
          50: '#f8efe3',
          100: '#ecd7bd',
          200: '#d4b189',
          300: '#bc8c59',
          400: '#9f6b3b',
          500: '#7c4f2c',
          600: '#603b21',
          700: '#452a18',
          800: '#311d11',
          900: '#21140c',
          950: '#150c07',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 20px rgba(211, 84, 43, 0.22)',
        'glow-sm': '0 0 10px rgba(243, 187, 82, 0.16)',
        'glow-lg': '0 0 40px rgba(243, 187, 82, 0.28)',
        'inner-glow': 'inset 0 0 20px rgba(243, 187, 82, 0.08)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-right': 'slideRight 0.2s ease-out',
        'speaking': 'speaking 1.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideRight: { from: { opacity: '0', transform: 'translateX(-8px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        speaking: {
          '0%, 100%': { boxShadow: '0 0 0 2px rgba(243, 187, 82, 0.45)' },
          '50%': { boxShadow: '0 0 0 4px rgba(201, 118, 33, 0.85)' },
        },
      },
      backgroundImage: {
        'grid-pattern': 'linear-gradient(rgba(243,187,82,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(201,118,33,0.04) 1px, transparent 1px)',
        'hero-gradient': 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(201,118,33,0.20), transparent)',
        'card-gradient': 'linear-gradient(135deg, rgba(243,187,82,0.08), rgba(0,0,0,0))',
      },
      backgroundSize: {
        'grid': '40px 40px',
      },
    },
  },
  plugins: [],
};
