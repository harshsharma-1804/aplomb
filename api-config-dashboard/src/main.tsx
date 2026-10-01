import "./monacoSetup";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { SessionProvider } from "./auth/SessionContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { BreadcrumbProvider } from "./components/BreadcrumbContext";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <BreadcrumbProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BreadcrumbProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
