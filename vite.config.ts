import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'API_');
  return { plugins: [react()], server: { port: 8000, strictPort: true, allowedHosts: ['fe.pawaret.uk'], proxy: { '/api': { target: `http://127.0.0.1:${env.API_PORT || 8001}`, changeOrigin: true } }, fs: { deny: ['.env', '.env.*', '**/.git/**', '**/server/**', `${process.cwd()}/work/**`, '**/*.pem', '**/data/**', '**/*service-account*.json'] } } };
});
