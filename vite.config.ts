import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset URLs let the same production bundle run at a GitHub Pages
  // project path (for example /SocialPost/) and from a local preview server.
  base: "./",
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    coverage: { reporter: ["text", "json", "html"] },
  },
});
