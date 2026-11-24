import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import { getUser, logout, onAuthChange } from "@netlify/identity";
import { api } from "./api.js";
import { PLATFORM_NAME, getLabId, setLabId } from "./config.js";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Protocols from "./pages/Protocols.jsx";
import ProtocolEditor from "./pages/ProtocolEditor.jsx";
import ProtocolView from "./pages/ProtocolView.jsx";
import Inventory from "./pages/Inventory.jsx";
import Activity from "./pages/Activity.jsx";
import Members from "./pages/Members.jsx";
import Tenure from "./pages/Tenure.jsx";
import Profile from "./pages/Profile.jsx";
import LabSettings from "./pages/LabSettings.jsx";
import Platform from "./pages/Platform.jsx";
import Welcome from "./pages/Welcome.jsx";
import Privacy from "./pages/Privacy.jsx";
import Landing from "./pages/Landing.jsx";
import { InstallButton } from "./install.jsx";

const MeContext = createContext(null);
export const useMe = () => useContext(MeContext);

export default function App() {
  const [authUser, setAuthUser] = useState(undefined); // undefined = loading
  const [me, setMe] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  // Password-reset links log the user in; keep them on the "new password" form until done.
  const [recovering, setRecovering] = useState(() => window.location.hash.includes("recovery_token"));
  // Logged-out visitors see the project homepage unless they arrived via a sign-in/invite/confirmation link.
  const [authView, setAuthView] = useState(() =>
    window.location.pathname === "/join" || window.location.pathname === "/login" || /_token=/.test(window.location.hash) ? "login" : null);

  useEffect(() => {
    getUser().then((u) => setAuthUser(u || null)).catch(() => setAuthUser(null));
    return onAuthChange((_e, u) => setAuthUser(u || null));
  }, []);

  const loadMe = useCallback(async () => {
    try {
      setLoadError("");
      // Arriving from an invitation link: open that lab.
      const join = new URLSearchParams(window.location.search).get("lab");
      let m = await api.get("/me");
      const wanted = join ? m.labs.find((l) => l.slug === join) : null;
      const current = wanted || m.labs.find((l) => String(l.lab_id) === getLabId()) || m.labs[0];
      if (current && String(current.lab_id) !== String(m.lab_id)) {
        setLabId(current.lab_id);
        m = await api.get("/me");
      } else if (current) setLabId(current.lab_id);
      else setLabId(null);
      setMe({ ...m, can: m.can || [] });
    } catch (e) {
      setMe(null);
      if (e.status === 401) {
        // Browser thinks it's signed in but the server has no session: start a clean sign-in.
        try { await logout(); } catch { /* ignore */ }
        setAuthUser(null);
        return;
      }
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => {
    if (authUser) loadMe();
    else setMe(null);
  }, [authUser, loadMe]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const switchLab = (id) => { setLabId(id); window.location.assign("/"); };

  if (location.pathname === "/privacy" && !me) return <Privacy standalone />;
  if (authUser === undefined) return <div className="splash">Loading…</div>;
  if (recovering) return <Login recovering onDone={() => setRecovering(false)} />;
  if (!authUser) {
    if (!authView) return <Landing onSignIn={() => setAuthView("login")} onSignUp={() => setAuthView("signup")} />;
    return <Login startMode={authView} onBack={() => setAuthView(null)} />;
  }
  if (!me) {
    return (
      <div className="splash">
        {loadError ? (
          <div className="card narrow">
            <h2>Couldn't load your account</h2>
            <p className="muted">{loadError}</p>
            <div className="row">
              <button onClick={loadMe}>Try again</button>
              <button className="ghost" onClick={() => logout()}>Log out</button>
            </div>
          </div>
        ) : "Loading your lab…"}
      </div>
    );
  }

  const inLab = !!me.lab_id;
  const has = (p) => me.can?.includes(p);
  const seesMembers = inLab && (has("manage_members") || has("view_activity") || me.role === "owner");
  const roleLabel = me.role === "owner" ? "PI / Owner" : me.role === "admin" ? "Admin" : me.role === "student" ? "Student" : "";
  const nav = inLab ? [
    ["/", "Dashboard"],
    ["/protocols", "Protocols"],
    ["/inventory", "Inventory"],
    ["/activity", has("view_activity") ? "Lab activity" : "My activity"],
    ...(seesMembers ? [["/members", "Members"]] : []),
    ...(me.role === "owner" ? [["/lab-settings", "Lab settings"]] : []),
  ] : [["/", "Get started"]];
  if (me.has_tenure) nav.push(["/tenure", "Tenure & promotion"]);
  if (me.is_platform_admin) nav.push(["/platform", "Platform admin"]);

  return (
    <MeContext.Provider value={{ me, reloadMe: loadMe, switchLab }}>
      <div className="shell">
        <header className="topbar">
          <button className="menu-btn ghost" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>☰</button>
          <div className="brand">
            <span className="logo" aria-hidden>⚗</span>
            <span className="brand-name">{inLab ? me.lab.name : PLATFORM_NAME}</span>
          </div>
          {me.labs.length > 1 && (
            <select className="lab-switch" value={me.lab_id || ""} onChange={(e) => switchLab(e.target.value)} aria-label="Switch lab">
              {me.labs.map((l) => <option key={l.lab_id} value={l.lab_id}>{l.name}</option>)}
            </select>
          )}
          <NavLink to="/profile" className="me-chip">
            {me.full_name || me.email}
            {roleLabel && <span className={`role-tag ${me.role}`}>{roleLabel}</span>}
          </NavLink>
        </header>
        <nav className={`sidebar ${menuOpen ? "open" : ""}`}>
          {nav.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>
          ))}
          <div className="spacer" />
          <InstallButton className="ghost install-link" />
          {inLab && <NavLink to="/start">+ Start another lab</NavLink>}
          <NavLink to="/profile">My profile</NavLink>
          <button className="ghost logout" onClick={() => logout()}>Log out</button>
          <div className="platform-foot">{PLATFORM_NAME} · <NavLink to="/privacy">Privacy & security</NavLink> · <a href="https://github.com/judebebo32/research-lab-hub/blob/main/CODE_OF_CONDUCT.md" target="_blank" rel="noreferrer">Code of Conduct</a> · <a href="https://github.com/judebebo32/research-lab-hub" target="_blank" rel="noreferrer">Open source</a></div>
        </nav>
        <main className="content">
          <Routes>
            {inLab ? (
              <>
                <Route path="/" element={<Dashboard />} />
                <Route path="/protocols" element={<Protocols />} />
                <Route path="/protocols/new" element={<ProtocolEditor />} />
                <Route path="/protocols/:id" element={<ProtocolView />} />
                <Route path="/protocols/:id/edit" element={<ProtocolEditor />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/activity" element={<Activity />} />
                {seesMembers && <Route path="/members" element={<Members />} />}
                {me.role === "owner" && <Route path="/lab-settings" element={<LabSettings />} />}
                <Route path="/start" element={<Welcome another />} />
              </>
            ) : (
              <Route path="/" element={<Welcome />} />
            )}
            <Route path="/profile" element={<Profile />} />
            <Route path="/privacy" element={<Privacy />} />
            {me.has_tenure && <Route path="/tenure" element={<Tenure />} />}
            {me.is_platform_admin && <Route path="/platform" element={<Platform />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </MeContext.Provider>
  );
}
