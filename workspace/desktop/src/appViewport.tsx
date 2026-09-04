import { createContext, type ReactNode, useContext } from "react";

export const APP_VIEWPORT_MOBILE_MAX = 760;
export const APP_VIEWPORT_TABLET_MAX = 900;

export type AppViewportMode = "mobile" | "tablet" | "desktop";

export type AppViewport = {
  width: number;
  mode: AppViewportMode;
  mobile: boolean;
  tablet: boolean;
};

export function appViewportForWidth(width: number): AppViewport {
  const safeWidth = Number.isFinite(width) && width >= 0 ? width : Number.POSITIVE_INFINITY;
  const mode: AppViewportMode = safeWidth <= APP_VIEWPORT_MOBILE_MAX
    ? "mobile"
    : safeWidth <= APP_VIEWPORT_TABLET_MAX
      ? "tablet"
      : "desktop";
  return {
    width: safeWidth,
    mode,
    mobile: mode === "mobile",
    tablet: mode === "tablet",
  };
}

const AppViewportContext = createContext<AppViewport | undefined>(undefined);

export function AppViewportProvider({ width, children }: { width: number; children: ReactNode }) {
  return <AppViewportContext.Provider value={appViewportForWidth(width)}>{children}</AppViewportContext.Provider>;
}

export function useAppViewport(): AppViewport {
  const viewport = useContext(AppViewportContext);
  if (viewport) return viewport;
  return appViewportForWidth(typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerWidth);
}
