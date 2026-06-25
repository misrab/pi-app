import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "streamdown/styles.css";
import "./index.css";

// Apply saved theme before first paint to avoid flash.
const saved = localStorage.getItem("theme");
document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
