import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: resolve(__dirname, "../dist/web"),
    emptyOutDir: true,
  },
});
