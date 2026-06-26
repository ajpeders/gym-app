/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#3c87f7',
          50: '#eef5ff',
          100: '#d9e8ff',
          500: '#3c87f7',
          600: '#2f6fd6',
          700: '#2557ad',
        },
      },
    },
  },
  plugins: [],
};
