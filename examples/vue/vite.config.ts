import vue from "@vitejs/plugin-vue";
import { grai } from "grai/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [vue(), grai()] });
