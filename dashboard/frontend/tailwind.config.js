/** @type {import('tailwindcss').Config} */
// The dashboard uses the same visual language as the public site (and the Goes Local sites): warm cream surfaces, navy ink,
// teal for positive states and coral for the brand. The neutral and accent scales are remapped once here, so every component
// follows without per-component changes.
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        slate: {
          50: '#FBF5EA', 100: '#F5EDDF', 200: '#E8DCC8', 300: '#D9CCB6', 400: '#5D6F86',
          500: '#4F6379', 600: '#42556B', 700: '#2E4157', 800: '#1B2A3A', 900: '#12263F', 950: '#0B1828',
        },
        emerald: {
          50: '#E4F1F1', 100: '#CBE5E5', 200: '#9FCFCF', 300: '#6DB6B6', 400: '#4AA3A3',
          500: '#2E8B8B', 600: '#267676', 700: '#1F6161', 800: '#184C4C', 900: '#123939', 950: '#0B2626',
        },
        // Small text in these two accents was below 4.5:1 on white and cream; the 600 step is darkened (WCAG AA).
        teal: { 600: '#0F766E' }, amber: { 600: '#B45309' },
        brand: { 50: '#FFF3EC', 100: '#FFE1D3', 500: '#E4572E', 600: '#C6461F', 700: '#A63A19', 900: '#5E210E' },
        coral: { 50: '#FFF3EC', 100: '#FFE1D3', 500: '#E4572E', 600: '#C6461F', 700: '#A63A19' },
      },
      fontFamily: {
        sans: ['Inter', 'Helvetica Neue', 'Arial', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
