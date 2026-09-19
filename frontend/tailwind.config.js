/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#b6d69a',
          50: '#f3f7ed',
          100: '#e5efd8',
          500: '#b6d69a',
          600: '#9cbd80',
          700: '#7fa461',
        },
        mint: {
          DEFAULT: '#7bc6a4',
          500: '#7bc6a4',
          600: '#56a582',
        },
        steel: {
          DEFAULT: '#a0b8cc',
          500: '#a0b8cc',
        },
        iron: {
          50: '#f2f3ed',
          100: '#dce0d5',
          200: '#c6cdbe',
          300: '#b0b6a8',
          400: '#929b89',
          500: '#727c69',
          700: '#3c4437',
          800: '#2b3028',
          850: '#22271f',
          900: '#1b1f18',
          950: '#121510',
        },
      },
    },
  },
  plugins: [],
};
