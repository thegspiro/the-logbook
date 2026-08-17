import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/modules/ip-security/store/ipSecurityStore.test.ts',
      'src/modules/public-portal/hooks/usePublicPortal.test.ts',
    ],
  },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
});
