import { useEffect, useState } from "react";
import { PLATFORM_NAME } from "../config.js";
import { login, signup, handleAuthCallback, acceptInvite, updateUser, requestPasswordRecovery } from "@netlify/identity";

// Sign in / create account, plus the links Netlify Identity emails out:
// email confirmation, invites (set first password) and password recovery.
// /join?lab=<short name>&email=<address> opens straight on "create account" for an invited person.
export default function Login({ recovering = false, onDone }) {
  const params = new URLSearchParams(window.location.search);
  const joinSlug = window.location.pathname === "/join" ? params.get("lab") : null;
  const [mode, setMode] = useState("checking"); // checking | login | signup | sent | invite | recovery | forgot
  const [token, setToken] = useState(null);
  const [joinLab, setJoinLab] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") || "");
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
          setMode(joinSlug ? "signup" : "login");
        }
      })
      .catch((e) => {
        setError(e.message || "That link is invalid or has expired.");
        setMode(joinSlug ? "signup" : "login");
      })
      .finally(() => {
        if (window.location.hash) history.replaceState(null, "", window.location.pathname);
      });
    if (joinSlug) {
      fetch(`/api/public/labs/${encodeURIComponent(joinSlug)}`).then((r) => (r.ok ? r.json() : null)).then(setJoinLab).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="brand big"><span className="logo" aria-hidden>⚗</span> {PLATFORM_NAME}</div>
        <p className="muted">Protocols, inventory and lab records for research groups — plus a private tenure & promotion tracker for faculty.</p>
        {joinLab && <p className="notice">You've been invited to <strong>{joinLab.name}</strong>{joinLab.institution ? ` (${joinLab.institution})` : ""}. Create your account with the invited email — or sign in if you already have one.</p>}

        {mode === "login" && (
          <form onSubmit={run(() => login(email.trim(), password))}>
            <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
            <button type="button" className="link" onClick={() => { setMode("forgot"); setError(""); }}>Forgot password?</button>
            <p className="fine">New here? <button type="button" className="link" onClick={() => { setMode("signup"); setError(""); }}>Create an account</button> — students join the lab that invited them; PIs can request a lab space.</p>
          </form>
        )}

        {mode === "signup" && (
          <form onSubmit={run(async () => {
            checkPasswords();
            const u = await signup(email.trim(), password, { full_name: name.trim() });
            if (u?.confirmedAt) await login(email.trim(), password);
            else setMode("sent");
          })}>
            <label>Full name<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label>Email{joinSlug && <span className="muted small"> (use the address you were invited with)</span>}<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label>Password<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <label>Confirm password<input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required /></label>
            <button disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
            <p className="fine">Already have an account? <button type="button" className="link" onClick={() => { setMode("login"); setError(""); }}>Sign in</button></p>
          </form>
        )}

        {mode === "sent" && (
          <div className="sent">
            <h3>Check your email ✉️</h3>
            <p>We sent a confirmation link to <strong>{email}</strong>. Click it to finish creating your account{joinLab ? ` and join ${joinLab.name}` : ""}.</p>
            <p className="fine">Nothing there after a few minutes? Check spam, or <button type="button" className="link" onClick={() => setMode("signup")}>try again</button>.</p>
          </div>
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
