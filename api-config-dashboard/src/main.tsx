import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/application.css";
import "./styles/palettes.css";
import "./monacoSetup";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { SessionProvider } from "./auth/SessionContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { BreadcrumbProvider } from "./components/BreadcrumbContext";
import { PageSaveProvider } from "./components/PageSave";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

function DashboardRoot() {
  return <ThemeProvider><BreadcrumbProvider><SessionProvider><PageSaveProvider><App /></PageSaveProvider></SessionProvider></BreadcrumbProvider></ThemeProvider>;
}
const router=createBrowserRouter([{path:"*",element:<DashboardRoot/>}]);
createRoot(root).render(<StrictMode><RouterProvider router={router}/></StrictMode>);
