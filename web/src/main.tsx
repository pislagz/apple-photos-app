import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminApp from "./admin/AdminApp";
import App from "./App";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root is missing from index.html");
}

// P1.11 adds a real router; until then, `/admin` is the one hand-rolled
// path so the P1.10 admin screens have somewhere to mount.
const isAdmin = window.location.pathname.startsWith("/admin");

createRoot(root).render(
  <StrictMode>{isAdmin ? <AdminApp /> : <App />}</StrictMode>,
);
