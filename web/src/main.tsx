import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminApp from "./admin/AdminApp";
import AppShell from "./shell/AppShell";
import "./shell/shell.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root is missing from index.html");
}

// `/admin` is the one hand-rolled path for the P1.10 admin screens;
// everything else gets the P1.11 shell (layout detection, login, PWA chrome).
const isAdmin = window.location.pathname.startsWith("/admin");

createRoot(root).render(
  <StrictMode>{isAdmin ? <AdminApp /> : <AppShell />}</StrictMode>,
);

// Same-origin app requests only -- see `public/sw.js`. Skipped under test,
// since jsdom has no `navigator.serviceWorker`.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}
