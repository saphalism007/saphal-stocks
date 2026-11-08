import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./App.tsx";

try {
  const t = localStorage.getItem("ss-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else if (window.matchMedia("(prefers-color-scheme: light)").matches) document.documentElement.dataset.theme = "light";
} catch { /* storage unavailable */ }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
