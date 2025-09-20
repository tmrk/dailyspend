import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  base: '/dailyspend/', // Replace 'dailyspend' with your repository name
  build: {
    outDir: 'dist'
  }
})