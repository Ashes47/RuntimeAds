import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import type { DashboardViewState } from "./types";

declare global {
  interface Window {
    __RUNTIMEADS_DASHBOARD_STATE__?: DashboardViewState;
  }
}

const container = document.getElementById("root");
const initialState = window.__RUNTIMEADS_DASHBOARD_STATE__;

if (!container || !initialState) {
  throw new Error("RuntimeAds dashboard failed to initialize");
}

createRoot(container).render(
  <StrictMode>
    <App initialState={initialState} />
  </StrictMode>,
);
