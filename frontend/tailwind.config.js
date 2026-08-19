/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
      },
      screens: {
        sm: '768px',
        md: '992px',
        lg: '1200px',
        xl: '1440px',
        '2xl': '1600px',
        '3xl': '1920px',
      },
    },
  },
  plugins: [],
};
