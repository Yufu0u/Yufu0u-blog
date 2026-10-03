import { defineConfig } from "astro/config";
import shirones from "./src/integration/index.ts";
export default defineConfig({ integrations: [shirones({pagefind:false,excludeRoutes:["/anime","/albums","/albums/[id]","/moments","/friends","/projects","/devices","/games","/timeline","/compass","/series","/series/[slug]"]})] });
