/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Static build only (ADR-0009, ADR-0024). Port 5173 matches ADMIN_APP_URL's
// default in the API, so local staff and admin invitation links open this app.
export default defineConfig({
  plugins: [react()],
  // For the first page's budget (tools/scripts/bundle-budget.mjs), which deletes it after reading.
  build: { manifest: true },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
