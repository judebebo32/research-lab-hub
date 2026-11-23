import { PLATFORM_NAME } from "../config.js";

const REPO = "https://github.com/judebebo32/research-lab-hub";

export function PoweredByNetlify({ className = "" }) {
  return (
    <a className={`powered-netlify ${className}`} href="https://www.netlify.com" target="_blank" rel="noreferrer">
      This site is powered by Netlify
    </a>
  );
}

const FEATURES = [
  ["🧪", "Protocols with PI review", "Students draft protocols in a rich editor (paste photos, videos and tables from Excel). The PI approves or requests changes before anything reaches the lab library. Every version is kept."],
  ["📦", "Shared lab inventory", "Reagents, consumables and equipment with one-tap usage logging, low-stock and expiry alerts, and a full history of who used what."],
  ["📈", "Automatic activity tracking", "Every protocol, review and inventory change is logged, so PIs can see each member's progress at a glance."],
  ["🎓", "Private tenure & promotion record", "Faculty log publications, grants, teaching, mentoring and service. An AI assistant turns a CV into structured entries, and a dossier view is ready to print."],
  ["🏛️", "Many labs, one platform", "Professors request a lab space and invite their own students. Labs are isolated from each other, and co-advised students can switch between labs."],
  ["🔒", "Privacy & backups", "Server-side access checks, private files, full data export, automatic Google Drive backup, and one-click lab or account deletion."],
];

// Public homepage of the open-source project, shown to visitors who aren't signed in.
export default function Landing({ onSignIn, onSignUp }) {
  return (
    <div className="landing">
      <header className="landing-top">
        <div className="brand"><span className="logo" aria-hidden>⚗</span> {PLATFORM_NAME}</div>
        <nav>
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          <a href="/privacy">Privacy</a>
          <button className="ghost" onClick={onSignIn}>Sign in</button>
        </nav>
      </header>

      <section className="hero">
        <p className="eyebrow">Free & open source · MIT licensed</p>
        <h1>Run your research lab in one place.</h1>
        <p className="lead">{PLATFORM_NAME} is an open-source platform where professors manage experimental protocols, lab inventory and team activity, and keep a private tenure & promotion record. Built by researchers, for research groups.</p>
        <div className="row hero-cta">
          <button onClick={onSignUp}>Create an account</button>
          <button className="ghost" onClick={onSignIn}>Sign in</button>
          <a className="btn ghost" href={REPO} target="_blank" rel="noreferrer">View the source on GitHub</a>
        </div>
        <p className="muted small">Students: use the invitation link from your PI. Professors: create an account and request a lab space; requests are reviewed by the platform admin.</p>
      </section>

      <section className="story card">
        <p className="eyebrow">Why this exists</p>
        <h2>Built by a PI, from the problems of running a real lab</h2>
        <div className="story-grid">
          <div className="story-text">
            <p>
              {PLATFORM_NAME} was built by <a href="https://judeokolie.com" target="_blank" rel="noreferrer"><strong>Jude Okolie</strong></a>, a faculty member who
              runs a research group and kept hitting the same problems most PIs know well.
            </p>
            <p>
              <strong>Paper-based protocols.</strong> Procedures lived in lab notebooks, printouts and scattered files. They were hard to find,
              hard to update, and impossible to review consistently. When a student graduated, much of how an experiment was actually done went with them.
            </p>
            <p>
              <strong>Incomplete or missing data.</strong> Key details such as concentrations, volumes, reagent lots and the small changes made
              on the day were often left unrecorded, so results were hard to reproduce and troubleshooting meant guesswork.
            </p>
            <p>
              <strong>Unclear expectations for students.</strong> Without a shared standard for what a complete protocol looks like, or when work
              should be reviewed, students and the PI weren't always on the same page. That meant repeated corrections and frustration on both sides.
            </p>
            <p>
              <strong>Documentation for tenure & promotion.</strong> On top of running the lab, every review cycle meant rebuilding a record of
              papers, grants, teaching and mentoring from memory and old emails.
            </p>
            <p>
              This platform is the answer to those problems, and it's shared openly so other research groups don't have to start from scratch.
            </p>
          </div>
          <ul className="story-fixes">
            <li><span>📄 → 💻</span><div><strong>From paper to one shared library</strong>Searchable, printable protocols with photos, videos and tables, and every version kept.</div></li>
            <li><span>✅</span><div><strong>Complete by design</strong>Every protocol has the same sections (objective, materials, equipment, procedure, safety, notes), so nothing important gets skipped.</div></li>
            <li><span>🤝</span><div><strong>Clear expectations</strong>Students submit; the PI approves or requests specific changes in writing. Everyone can see where each protocol stands.</div></li>
            <li><span>🔎</span><div><strong>Traceable lab data</strong>Inventory use is logged with who, what, how much and why, linked to the experiment. Activity is recorded automatically.</div></li>
            <li><span>🎓</span><div><strong>Tenure records that build themselves</strong>Log activities as they happen, or let the AI import your CV, then print a dossier when it's time.</div></li>
          </ul>
        </div>
      </section>

      <section className="shot-main">
        <img src="/screenshots/dashboard.jpg" alt="Lab dashboard with protocol status counts, inventory alerts and recent activity (sample data)" loading="lazy" />
      </section>

      <section className="features">
        {FEATURES.map(([icon, title, text]) => (
          <div key={title} className="feature">
            <div className="feature-icon" aria-hidden>{icon}</div>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </section>

      <section className="shots">
        <figure><img src="/screenshots/protocol-review.jpg" alt="Protocol page with PI review comments and version history" loading="lazy" /><figcaption>PI review, comments and version history</figcaption></figure>
        <figure><img src="/screenshots/protocol-editor.jpg" alt="Rich protocol editor with pasted table and formatting" loading="lazy" /><figcaption>Rich editor: tables, photos, videos, formatting</figcaption></figure>
        <figure><img src="/screenshots/inventory.jpg" alt="Inventory list with stock status and usage buttons" loading="lazy" /><figcaption>Inventory with usage logging and alerts</figcaption></figure>
      </section>
      <p className="muted small center">Screenshots use made-up sample data.</p>

      <section className="oss card">
        <h2>Open source project</h2>
        <div className="oss-grid">
          <div>
            <h3>Use it or host your own</h3>
            <p className="small">Any research group can use this platform, or deploy a private copy for their lab, department or institution in about 10 minutes with the one-click <strong>Deploy to Netlify</strong> button in the README.</p>
            <p className="small"><a href={`${REPO}#host-your-own-platform`} target="_blank" rel="noreferrer">Setup guide →</a></p>
          </div>
          <div>
            <h3>Contribute</h3>
            <p className="small">Bug reports, feature ideas, documentation and code are all welcome, especially from labs in other fields.</p>
            <p className="small"><a href={`${REPO}/issues`} target="_blank" rel="noreferrer">Issues</a> · <a href={`${REPO}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer">Contributing guide</a></p>
          </div>
          <div>
            <h3>Community & policies</h3>
            <p className="small">
              <a href={`${REPO}/blob/main/CODE_OF_CONDUCT.md`} target="_blank" rel="noreferrer">Code of Conduct</a><br />
              <a href="/privacy">Privacy & Data Security Statement</a><br />
              <a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">Security policy</a><br />
              <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT License</a>
            </p>
          </div>
        </div>
      </section>

      <footer className="landing-foot">
        <span>{PLATFORM_NAME} · free, non-commercial, open source</span>
        <span>
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a> ·{" "}
          <a href={`${REPO}/blob/main/CODE_OF_CONDUCT.md`} target="_blank" rel="noreferrer">Code of Conduct</a> ·{" "}
          <a href="/privacy">Privacy</a> ·{" "}
          <PoweredByNetlify />
        </span>
      </footer>
    </div>
  );
}
