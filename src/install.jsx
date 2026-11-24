import { useEffect, useState } from "react";
import { Modal } from "./ui.jsx";

// Android/desktop Chrome fire this event; we keep it so a button can show the native install dialog.
let deferredPrompt = null;
const listeners = new Set();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; listeners.forEach((f) => f()); });
  window.addEventListener("appinstalled", () => { deferredPrompt = null; listeners.forEach((f) => f()); });
}

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); listeners.add(f); return () => listeners.delete(f); }, []);
  return { canPrompt: !!deferredPrompt, installed: isStandalone() };
}

// Button + help dialog. Hidden once the person is already using the installed app.
export function InstallButton({ className = "", label = "📲 Install app" }) {
  const { canPrompt, installed } = useInstall();
  const [open, setOpen] = useState(false);
  if (installed) return null;
  const click = async () => {
    if (canPrompt && deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch { /* ignore */ }
      deferredPrompt = null;
      listeners.forEach((f) => f());
      return;
    }
    setOpen(true);
  };
  return (
    <>
      <button type="button" className={className} onClick={click}>{label}</button>
      {open && <InstallHelp onClose={() => setOpen(false)} />}
    </>
  );
}

function InstallHelp({ onClose }) {
  const ios = isIOS(), android = isAndroid();
  return (
    <Modal title="Install the app on your phone" onClose={onClose}>
      <div className="install-help">
        {(ios || (!ios && !android)) && (
          <section>
            <h4>iPhone / iPad</h4>
            <ol>
              <li>Open this site in <strong>Safari</strong>.</li>
              <li>Tap the <strong>Share</strong> button <span className="kbd">⬆︎</span> (bottom of the screen, or top on iPad).</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
            </ol>
          </section>
        )}
        {(android || (!ios && !android)) && (
          <section>
            <h4>Android</h4>
            <ol>
              <li>Open this site in <strong>Chrome</strong>.</li>
              <li>Tap the <strong>⋮</strong> menu (top right).</li>
              <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>), then <strong>Install</strong>.</li>
            </ol>
          </section>
        )}
        {!ios && !android && <p className="muted small">On a computer, Chrome and Edge show an install icon at the right end of the address bar.</p>}
        <p className="muted small">The app opens full screen from your home screen and always runs the latest version. For privacy, lab data isn't stored on the phone — you'll need an internet connection.</p>
      </div>
      <div className="row end"><button type="button" onClick={onClose}>Got it</button></div>
    </Modal>
  );
}
