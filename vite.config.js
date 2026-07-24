import os from 'os'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function getLocalLanIp() {
  const interfaces = Object.values(os.networkInterfaces() || {}).flat();
  const candidates = interfaces
    .filter((entry) => entry && !entry.internal && entry.family === 'IPv4')
    .map((entry) => entry.address)
    .filter(Boolean);

  return candidates.find((address) => address.startsWith('192.168.') || address.startsWith('10.') || address.startsWith('172.')) || candidates[0] || '';
}

const lanIp = getLocalLanIp();

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? './' : '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  define: {
    __RESELL_OS_LAN_ORIGIN__: JSON.stringify(lanIp ? `http://${lanIp}:5173` : ''),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
}))
