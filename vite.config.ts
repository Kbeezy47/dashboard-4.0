import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || ''),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || '')
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      // Allow access via LAN IP (e.g. 192.168.x.x) from other devices on the
      // home network. Vite blocks non-localhost hosts by default.
      allowedHosts: true
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.')
      }
    }
  };
});