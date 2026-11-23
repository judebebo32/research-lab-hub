# Research Lab Hub

**An open-source platform where professors run their labs:** experimental protocols with PI review, shared lab inventory, automatic activity tracking, and a private tenure & promotion record — with an AI assistant that turns a CV into structured records.

Built for research groups that keep protocols in scattered Word files, track reagents on paper, and rebuild their tenure dossier from memory every year. One deployment hosts **many labs**: professors sign up and request a lab space, the platform admin approves it, and each PI invites their own students. Labs are fully isolated from each other. Runs on [Netlify](https://www.netlify.com/) with no servers to manage — host a shared platform for your department or institution, or just for your own group.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/judebebo32/research-lab-hub)

> Live example: the Okolie Lab runs this at its own invite-only site. Screenshots below use made-up sample data.

![Dashboard](docs/screenshots/dashboard.png)

## Features

**Protocols with review before publishing**
- Rich editor in every section: paste photos, screenshots and tables straight from Excel/Word, upload videos, font sizes, colors, lists, sub/superscript (H₂O, 10⁶).
- Students write protocols as drafts and submit them; the PI (or a delegated reviewer) approves or requests changes with comments.
- Only approved protocols appear in the lab library. Editing an approved protocol sends it back for review.
- Full version history — every save is kept and viewable side by side.
- Duplicate, print and archive.

**Lab inventory**
- Flexible categories for wet, dry and mixed labs (reagents, biologicals, consumables, equipment, parts, licenses…).
- One-tap *Use* / *Restock* logging with reasons, so every change is traceable.
- Low-stock and expiry alerts on the dashboard; CSV export.

**Activity tracking**
- Every action (protocol written, reviewed, inventory used…) is logged automatically.
- PI view of each member's activity, protocols and last sign-in; CSV export.

**Tenure & promotion record (private to each faculty member)**
- Publications, grants (with funded totals), teaching, mentoring, service, talks, awards, outreach.
- **✨ AI import:** upload a CV (PDF/Word) or paste lists; Claude drafts entries, flags likely duplicates, and nothing is saved until you review it.
- Printable dossier view and CSV export.

**Many labs, one platform**
- Professors create an account and request a lab (name, short link name, institution); a platform admin approves requests.
- PIs invite students and co-admins by email from inside the app and get a join link to send — no hosting-dashboard access needed.
- Every lab's protocols, inventory, files, activity and members are separated on the server; the platform admin sees usage numbers only.
- Co-advised students belong to several labs and switch between them.
- Free-with-limits model: per-lab photo/video storage and monthly AI-import limits, adjustable per lab.

**People & access**
- Owner role for each lab's PI; add co-admins with fine-grained permissions (review protocols, edit protocols, manage inventory, see activity, manage students, own tenure tracker).
- PIs can rename their lab and its short name at any time.

**Backups**
- One-click full data download.
- Optional automatic weekly backup to the owner's Google Drive (data + photos/videos), using a Drive scope that can only see the backup folder it creates.

| Protocol review | Rich editor | Inventory |
|---|---|---|
| ![Protocol review](docs/screenshots/protocol-review.png) | ![Editor](docs/screenshots/protocol-editor.png) | ![Inventory](docs/screenshots/inventory.png) |

## How it's built

| Part | Technology |
|---|---|
| Front end | React + Vite (single-page app), TipTap editor, DOMPurify for safe rendering |
| API | One Netlify Function (`netlify/functions/api.mjs`) with server-side permission checks on every request |
| Database | [Netlify Database](https://docs.netlify.com/) (managed Postgres); schema in `netlify/database/migrations/` |
| Logins | Netlify Identity (`@netlify/identity`), invite-only |
| Files | Netlify Blobs for photos/videos (chunked uploads, range streaming for video) |
| AI | Claude via Netlify AI Gateway (uses your Netlify credits; no API key needed) |
| Jobs | Netlify background + scheduled functions (Drive backup, AI import) |

## Host your own platform

You need a free [Netlify](https://app.netlify.com/signup) account on a credit-based plan.

1. **Deploy.** Click **Deploy to Netlify** above (or fork this repo and import it in Netlify). The database is created automatically on the first deploy.
2. **Set environment variables** in Netlify → your project → *Environment variables*, then redeploy:
   | Variable | Example | What it does |
   |---|---|---|
   | `ADMIN_EMAILS` | `you@university.edu` | **Platform admins** who approve lab requests (comma-separated) |
   | `PLATFORM_NAME` | `Chemistry Lab Hub` | Name of the platform shown on sign-in (default *Research Lab Hub*) |
3. **Turn on logins.** Netlify → your project → **Users and sign-in** (Identity): enable it and set registration to **Open** (new accounts can't see anything until they're approved or invited). Keep email confirmation on.
4. **Create your account** on the site, request your own lab, and approve it on the **Platform admin** page.
5. **Invite your students** from **Members → Invite student** and send them the join link.

Other professors simply create an account and request a lab; you approve them under **Platform admin**, where you can also adjust each lab's storage and AI limits (defaults: 2 GB, 5 AI imports/month).

Optional:
- **Google Drive backup (per lab):** *Lab settings → Google Drive backup → Show setup steps* walks each PI through a 10-minute Google Cloud setup.
- **AI import:** works automatically on credit-based Netlify plans via AI Gateway.

### Check with your institution

Before storing student or research data, confirm with your IT/research office that this hosting is acceptable under your institution's data policies. If you host a shared platform for other labs, publish terms of use and a privacy notice that fit your institution, and review them with your institution's legal or research office.

### Upgrading from the single-lab version

Existing data moves into lab #1 automatically on deploy (named from the old `LAB_NAME` variable), with everyone keeping their role. Switch Identity registration to **Open** so new professors and students can sign up.

## Develop locally

```bash
npm install
npm test          # API tests against a real local Postgres (Identity, Blobs, Google and AI are stubbed)
npm run build     # front end
npx netlify dev   # full local stack (logins require a deployed site)
```

Project layout:

```
src/                      React app (pages/, RichEditor.jsx, media.jsx)
netlify/functions/        api.mjs (all routes), drive-backup*, tenure-ai (background jobs)
netlify/database/migrations/  SQL schema, applied automatically on deploy
lib/                      shared server code (backups, Google Drive, AI import)
tests/                    end-to-end API tests
```

## Contributing

Contributions are welcome — bug reports, features, documentation, and accounts of how your lab uses it. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 Jude Okolie
