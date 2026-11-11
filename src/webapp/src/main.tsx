import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { SiteConfigProvider } from "./siteConfig";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SiteConfigProvider>
      <App />
    </SiteConfigProvider>
  </React.StrictMode>
);