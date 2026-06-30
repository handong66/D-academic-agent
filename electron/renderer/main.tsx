import "@fontsource-variable/fraunces/index.css";
import "@fontsource-variable/hanken-grotesk/index.css";
import "@fontsource/ibm-plex-mono/index.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import { initLang } from "./i18n";
import { initTheme } from "./theme";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root");
}

initTheme();
initLang();

createRoot(root).render(<App />);
