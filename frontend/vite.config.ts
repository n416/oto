import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { backendManagerPlugin } from './vite-plugin-backend-manager'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), backendManagerPlugin()],
})
