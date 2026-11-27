import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'pruebas',
  use: {
    baseURL: 'http://localhost:8766',
    serviceWorkers: 'block',
    locale: 'es-ES',
    // PW_CANAL=msedge o chrome usa el navegador ya instalado en vez del que descarga Playwright.
    channel: process.env.PW_CANAL || undefined,
  },
  webServer: { command: 'npx http-server -p 8766 -c-1 --silent', port: 8766, reuseExistingServer: true },
});
