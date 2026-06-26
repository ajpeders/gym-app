/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#f97316',
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
        },
        iron: {
          50: '#f5f5f4',
          100: '#e7e5e4',
          300: '#a8a29e',
          400: '#78716c',
          500: '#57534e',
          700: '#292524',
          800: '#1c1917',
          850: '#171412',
          900: '#12100e',
          950: '#080706',
        },
      },
    },
  },
  plugins: [],
};
