import { request } from "@playwright/test";

// Family login (#519) is on by default, so a fresh demo opens on "Who's watching?".
// Most specs sign in through the plain username/password form on "/", so the suite
// starts with it OFF. family519.e2e.ts turns it ON for itself and restores OFF.
export default async function globalSetup() {
  const baseURL = process.env.DEMO_URL ?? "http://127.0.0.1:8000";
  const api = await request.newContext({ baseURL });
  const login = await api.post("/api/auth/login", {
    data: { username: "demo-admin", password: "demo-admin-pass-1" },
  });
  if (!login.ok()) throw new Error(`e2e global setup: admin login failed (${login.status()})`);
  const res = await api.put("/api/admin/settings/family-login", {
    data: { enabled: false, passwordless_signin: "private" },
  });
  if (!res.ok()) throw new Error(`e2e global setup: family-login off failed (${res.status()})`);
  await api.dispose();
}
