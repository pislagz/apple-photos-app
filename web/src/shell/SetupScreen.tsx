import { useState } from "react";
import type { Layout } from "./useLayout";

export default function SetupScreen({
  layout,
  error,
  onSubmit,
}: {
  layout: Layout;
  error: string | null;
  onSubmit: (username: string, password: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSubmit(username, password);
  }

  return (
    <main className={layout === "mobile" ? "login-screen login-screen--mobile" : "login-screen login-screen--desktop"}>
      <div className="login-card">
        <h1>Create admin account</h1>
        <p>No account exists yet. The first account created here becomes the admin.</p>
        {error && <p role="alert">{error}</p>}
        <form onSubmit={handleSubmit}>
          <label>
            Username
            <input
              value={username}
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit">Create admin account</button>
        </form>
      </div>
    </main>
  );
}
