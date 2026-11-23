import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import { getUser, logout, onAuthChange } from "@netlify/identity";
import { api } from "./api.js";
import { LAB_NAME } from "./config.js";
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

  useEffect(() => {
    getUser().then((u) => setAuthUser(u || null)).catch(() => setAuthUser(null));
    return onAuthChange((_e, u) => setAuthUser(u || null));
  }, []);

  const loadMe = useCallback(async () => {
    try {
      setLoadError("");
      const m = await api.get("/me");
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

  if (authUser === undefined) return <div className="splash">Loading…</div>;
  if (recovering) return <Login recovering onDone={() => setRecovering(false)} />;
  if (!authUser) return <Login />;
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

  const has = (p) => me.can?.includes(p);
  const seesMembers = has("manage_members") || has("view_activity");
  const roleLabel = me.role === "owner" ? "PI / Owner" : me.role === "admin" ? "Admin" : "Student";
  const nav = [
    ["/", "Dashboard"],
    ["/protocols", "Protocols"],
    ["/inventory", "Inventory"],
    ["/activity", has("view_activity") ? "Lab activity" : "My activity"],
    ...(seesMembers ? [["/members", has("owner") ? "Members & access" : "Members"]] : []),
    ...(has("tenure") ? [["/tenure", "Tenure & promotion"]] : []),
  ];

  return (
    <MeContext.Provider value={{ me, reloadMe: loadMe }}>
      <div className="shell">
        <header className="topbar">
          <button className="menu-btn ghost" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>☰</button>
          <div className="brand">
            <span className="logo" aria-hidden>⚗</span>
            <span>{LAB_NAME}</span>
          </div>
          <NavLink to="/profile" className="me-chip">
            {me.full_name || me.email}
            <span className={`role-tag ${me.role}`}>{roleLabel}</span>
          </NavLink>
        </header>
        <nav className={`sidebar ${menuOpen ? "open" : ""}`}>
          {nav.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>
          ))}
          <div className="spacer" />
          <NavLink to="/profile">My profile</NavLink>
          <button className="ghost logout" onClick={() => logout()}>Log out</button>
        </nav>
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/protocols" element={<Protocols />} />
            <Route path="/protocols/new" element={<ProtocolEditor />} />
            <Route path="/protocols/:id" element={<ProtocolView />} />
            <Route path="/protocols/:id/edit" element={<ProtocolEditor />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/profile" element={<Profile />} />
            {seesMembers && <Route path="/members" element={<Members />} />}
            {has("tenure") && <Route path="/tenure" element={<Tenure />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </MeContext.Provider>
  );
}
