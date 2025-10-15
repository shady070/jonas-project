import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {     allowedHosts: [
      'summit-smithsonian-publication-limited.trycloudflare.com',
      '.trycloudflare.com', // wildcard for any cloudflare tunnel
      '.loca.lt',            // if you use localtunnel too
      '.ngrok-free.app',     // if you use ngrok
    ], port: 5173, host: true },
  define: { __VUE_OPTIONS_API__: true, __VUE_PROD_DEVTOOLS__: false }
})
