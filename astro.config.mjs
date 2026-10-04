import { defineConfig } from "astro/config";
import shirones from "./src/integration/index.ts";
export default defineConfig({
  integrations: [shirones({ pagefind: false })],
});
