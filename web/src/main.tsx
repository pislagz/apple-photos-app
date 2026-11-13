import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminApp from "./admin/AdminApp";
import ControlsGallery from "./admin/ui/ControlsGallery";
import AppShell from "./shell/AppShell";
import "./shell/tokens.css";
import "./shell/shell.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root is missing from index.html");
}

// `/admin` is the one hand-rolled path for the P1.10 admin screens;
// everything else gets the P1.11 shell (layout detection, login, PWA chrome).
// `/admin/controls` is a design-review page for the shared admin controls
// (#308). It exists only in dev, or in a build made with
// VITE_ADMIN_GALLERY=1 for the screenshot spec; Vite drops it from a normal
// production build because the flag is a build-time constant.
const showGallery =
  (import.meta.env.DEV || import.meta.env.VITE_ADMIN_GALLERY === "1") &&
  window.location.pathname === "/admin/controls";
const isAdmin = window.location.pathname.startsWith("/admin");

createRoot(root).render(
  <StrictMode>{showGallery ? <ControlsGallery /> : isAdmin ? <AdminApp /> : <AppShell />}</StrictMode>,
);

// Same-origin app requests only -- see `public/sw.js`. Skipped under test,
// since jsdom has no `navigator.serviceWorker`.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}
