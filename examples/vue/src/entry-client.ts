// In dev, an edited message renders again in place, and the page keeps its state.
import "@xyrolle/grai/vue/client";
import { createApp } from "./main.ts";

// The page renders in its <html lang>, the locale the server drew it in.
createApp().mount("#app");
