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
      'src/utils/formValues.test.ts',
      'src/utils/errorHandling.test.ts',
      'src/utils/apiCache.test.ts',
      'src/utils/createApiClient.test.ts',
    ],
  },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
});
