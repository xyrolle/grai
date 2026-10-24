import vue from "@vitejs/plugin-vue";
import { grai } from "grai/vite";
import { defineConfig } from "vite";

// localeChunks: each page loads only its locale's copies of the message chunks.
export default defineConfig({ plugins: [vue(), grai({ localeChunks: true })] });
