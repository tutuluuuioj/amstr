import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api/near-rpc': {
        target: 'https://near-testnet.drpc.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/near-rpc/, ''),
      },
      '/api/cvm': {
        target: 'https://2dba4d4f68ab082e126801c1271d5fbc1abff3bd-3000.dstack-pha-prod5.phala.network',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/cvm/, ''),
      },
    },
  },
});
