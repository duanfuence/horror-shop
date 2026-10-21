import { defineConfig } from 'vitest/config';

// Относительные пути (base: './') обязательны: на Яндекс Играх игра
// открывается из вложенного каталога, а не из корня домена.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
  // Сервер доступен только на этом компьютере. Для телефона в локальной сети —
  // явные команды npm run dev:lan / npm run preview:lan.
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
