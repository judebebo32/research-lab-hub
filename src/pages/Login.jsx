import { useEffect, useState } from "react";
import { LAB_NAME } from "../config.js";
import { login, handleAuthCallback, acceptInvite, updateUser, requestPasswordRecovery } from "@netlify/identity";

// Handles normal login plus the links Netlify Identity emails out:
// invites (set first password), password recovery and email confirmation.
export default function Login({ recovering = false, onDone }) {
  const [mode, setMode] = useState("checking"); // checking | login | invite | recovery | forgot
  const [token, setToken] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    handleAuthCallback()
      .then((result) => {
        if (result?.type === "invite" && result.token) {
          setToken(result.token);
          setMode("invite");
        } else if (recovering || result?.type === "recovery") {
          setMode("recovery");
        } else {
          setMode("login");
        }
      })
      .catch((e) => {
        setError(e.message || "That link is invalid or has expired.");
        setMode("login");
      })
      .finally(() => {
        if (window.location.hash) history.replaceState(null, "", window.location.pathname);
      });
  }, []);

  const run = (fn) => async (e) => {
    e.preventDefault();
    setError(""); setMsg(""); setBusy(true);
    try { await fn(); } catch (err) { setError(err.message || "Something went wrong"); }
    finally { setBusy(false); }
  };

  const checkPasswords = () => {
    if (password.length < 8) throw new Error("Use at least 8 characters.");
    if (password !== password2) throw new Error("Passwords don't match.");
  };

  if (mode === "checking") return <div className="splash">Loading…</div>;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand big"><span className="logo" aria-hidden>⚗</span> {LAB_NAME}</div>
        <p className="muted">Protocols, inventory and lab records in one place.</p>

        {mode === "login" && (
          <form onSubmit={run(() => login(email.trim(), password))}>
            <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
            <button type="button" className="link" onClick={() => { setMode("forgot"); setError(""); }}>Forgot password?</button>
            <p className="fine">Accounts are invite-only. Ask your PI for an invite.</p>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={run(async () => { await requestPasswordRecovery(email.trim()); setMsg("If that email has an account, a reset link is on its way."); })}>
            <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <button disabled={busy}>Send reset link</button>
            <button type="button" className="link" onClick={() => setMode("login")}>Back to sign in</button>
          </form>
        )}

        {mode === "invite" && (
          <form onSubmit={run(async () => {
            checkPasswords();
            const u = await acceptInvite(token, password);
            // acceptInvite doesn't set the session cookie the server reads; a normal login does.
            await login(u.email, password);
          })}>
            <h3>Welcome to the lab 👋</h3>
            <p className="muted">Choose a password to finish setting up your account.</p>
            <label>New password<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <label>Confirm password<input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required /></label>
            <button disabled={busy}>Create account</button>
          </form>
        )}

        {mode === "recovery" && (
          <form onSubmit={run(async () => { checkPasswords(); const u = await updateUser({ password }); if (u?.email) await login(u.email, password); onDone?.(); })}>
            <h3>Set a new password</h3>
            <label>New password<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <label>Confirm password<input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required /></label>
            <button disabled={busy}>Save password</button>
          </form>
        )}

        {msg && <p className="ok">{msg}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
