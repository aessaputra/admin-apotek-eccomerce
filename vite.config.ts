import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router"],
          antd: ["antd", "@ant-design/icons"],
          refine: [
            "@refinedev/core",
            "@refinedev/antd",
            "@refinedev/react-router",
            "@refinedev/supabase",
          ],
          i18n: ["i18next", "react-i18next"],
        },
      },
    },
  },
});
