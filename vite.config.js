import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ base: process.env.GITLAB_CI ? "/ats-interview-system/" : "/", plugins: [react()], server: { proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } } } });
