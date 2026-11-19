// Must run before the router reads the location (see lib/history-base).
import "@/lib/history-base";
import "@github/relative-time-element";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./i18n";
import "./index.css";
import { Toast, Tooltip } from "@usememos/ui";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { refreshAccessToken } from "@/connect";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { InstanceProvider, useInstance } from "@/contexts/InstanceContext";
import { useLiveMemoRefresh } from "@/hooks/useLiveMemoRefresh";
import { useTokenRefreshOnFocus } from "@/hooks/useTokenRefreshOnFocus";
import { startOutboxSync } from "@/lib/offline/outbox";
import { persistQueries, restoreQueries } from "@/lib/offline/query-persist";
import { queryClient } from "@/lib/query-client";
import { toast } from "@/lib/toast";
import router from "./router";
import { applyLocaleEarly, useTranslate } from "./utils/i18n";
import { applyThemeEarly } from "./utils/theme";

// Apply theme and locale early to prevent flash
applyThemeEarly();
applyLocaleEarly();

// Inner component that initializes contexts
function AppInitializer({ children }: { children: React.ReactNode }) {
  const { isIdentityInitialized, initialize: initAuth, currentUser } = useAuth();
  const { isProfileInitialized, initialize: initInstance } = useInstance();
  const initStartedRef = useRef(false);

  // Initialize on mount - run in parallel for better performance
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    const init = async () => {
      await Promise.all([initInstance(), initAuth()]);
    };
    init();
  }, [initAuth, initInstance]);

  // Proactively refresh token on window focus to prevent 401 errors
  // Only enabled when user is authenticated
  // Related: https://github.com/usememos/memos/issues/5589
  useTokenRefreshOnFocus(refreshAccessToken, !!currentUser);

  // Live refresh: listen for memo changes via SSE and invalidate caches.
  useLiveMemoRefresh();

  // Route loading and feed requests only need the verified identity and the
  // instance profile. Display-sensitive settings continue in the background;
  // PagedMemoList keeps memo content hidden until privacy settings have settled.
  if (!isIdentityInitialized || !isProfileInitialized) {
    return null;
  }

  return <>{children}</>;
}

/** The one place toasts render, with their close buttons named in the user's language. */
function ToastViewport() {
  const t = useTranslate();
  return <Toast.Viewport closeLabel={t("common.close")} />;
}

function Main() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <InstanceProvider>
          <AuthProvider>
            <Tooltip.Provider>
              <AppInitializer>
                <Toast.Provider toastManager={toast}>
                  <RouterProvider router={router} />
                  <ToastViewport />
                </Toast.Provider>
              </AppInitializer>
            </Tooltip.Provider>
          </AuthProvider>
        </InstanceProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const container = document.getElementById("root");
const root = createRoot(container as HTMLElement);

// Offline (lib/offline): show the last saved data at once, keep it saved, and sync what was
// written offline. Restoring waits at most a moment so a slow disk never delays the app.
const start = async () => {
  await Promise.race([restoreQueries(queryClient), new Promise((resolve) => setTimeout(resolve, 1500))]);
  persistQueries(queryClient);
  startOutboxSync(queryClient);
  root.render(<Main />);
};
void start();

// The service worker keeps the app itself available offline (public/sw.js). Production only:
// in development it would serve stale modules.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("Service worker registration failed:", error));
  });
}
