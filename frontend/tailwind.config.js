/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#5eead4',
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#5eead4',
          600: '#22d3ee',
          700: '#0891b2',
        },
        mint: {
          DEFAULT: '#34d399',
          500: '#34d399',
          600: '#10b981',
        },
        steel: {
          DEFAULT: '#60a5fa',
          500: '#60a5fa',
        },
        iron: {
          50: '#f8fafc',
          100: '#e2e8f0',
          300: '#94a3b8',
          400: '#64748b',
          500: '#475569',
          700: '#253149',
          800: '#121a2a',
          850: '#0b1220',
          900: '#070d18',
          950: '#030712',
        },
      },
    },
  },
  plugins: [],
};
