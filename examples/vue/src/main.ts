import { createSSRApp } from "vue";
import App from "./App.vue";

/** The app, for the server to render and the browser to hydrate. */
export function createApp() {
	return createSSRApp(App);
}
