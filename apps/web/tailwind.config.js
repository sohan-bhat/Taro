/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Taro root lavender-violet - the product's namesake, used sparingly
        taro: {
          50: '#F7F5FB',
          100: '#EFEAF6',
          200: '#DDD3EC',
          300: '#C3B2DC',
          400: '#A488C6',
          500: '#8A66B0',
          600: '#745097',
          700: '#5F407C',
          800: '#4E3564',
          900: '#3B2849',
        },
        // Violet-biased neutrals so greys read as chosen, not defaulted
        fog: {
          50: '#FAF9FB',
          100: '#F3F1F6',
          200: '#E7E4ED',
          300: '#D5D1DD',
          400: '#A9A3B5',
          500: '#837D91',
          600: '#5F5A6C',
          700: '#474351',
          800: '#2F2C38',
          900: '#1C1923',
        },
      },
      fontFamily: {
        display: ['var(--font-sora)', 'sans-serif'],
        sans: ['var(--font-gabarito)', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'monospace'],
      },
    },
  },
  plugins: [],
};
