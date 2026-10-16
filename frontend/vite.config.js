import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      onLog(level, log, defaultHandler) {
        if (level === "warn" && log.code === "INVALID_ANNOTATION") {
          return;
        }

        defaultHandler(level, log);
      },
    },
  },
  server: {
    host: true,
  },
});
