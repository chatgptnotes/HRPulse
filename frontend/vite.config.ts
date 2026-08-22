import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // The workspace dev command runs Vite from frontend/, while the local
  // .env file is kept at the repository root. Always load that root file.
  const env = loadEnv(mode, '..', '');
  return {
    plugins: [react()],
    envDir: '..',
    // Only these two Supabase values are public client configuration. Never
    // expose DATABASE_URL, GEMINI_API_KEY, or a service-role key to the browser.
    define: {
      'import.meta.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL),
      'import.meta.env.SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY),
      'import.meta.env.ADAMRIT_SUPABASE_URL': JSON.stringify(env.ADAMRIT_SUPABASE_URL),
      'import.meta.env.ADAMRIT_SUPABASE_ANON_KEY': JSON.stringify(env.ADAMRIT_SUPABASE_ANON_KEY),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
