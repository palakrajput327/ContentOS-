import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./AuthApp";
import "./styles.css";
import "./workspace.css";
import "./design-system.css";
import "./marketing.css";
import { AppearanceProvider, useAppearance } from './lib/appearance';
import { ErrorBoundary } from './components/ErrorBoundary';
function Notifications() { const {theme}=useAppearance(); return <Toaster theme={theme} position="bottom-right" richColors />; }
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15000 } },
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <ErrorBoundary>
          <AppearanceProvider><App /><Notifications /></AppearanceProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
