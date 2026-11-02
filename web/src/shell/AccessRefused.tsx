// P1.4's tailnet allow-list rejects a request before it even looks at a
// password (`session_auth._enforce_tailnet_allowlist`), so this replaces
// the login screen *and* the app shell outright -- showing either one as
// if the identity merely typed a wrong password would hide the real cause.
export default function AccessRefused() {
  return (
    <main className="access-refused">
      <h1>Access refused</h1>
      <p role="alert">
        This device isn&rsquo;t on the allow-list for this server. Ask the admin to add your tailnet identity.
      </p>
    </main>
  );
}
