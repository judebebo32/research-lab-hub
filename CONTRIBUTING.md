# Contributing to Research Lab Hub

Thanks for helping make lab management easier for research groups. By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help
- **Report a bug or request a feature:** open a GitHub issue. Describe what you expected, what happened, and (for bugs) steps to reproduce. Never include real student data, passwords or unpublished results in an issue.
- **Share how your lab uses it:** what works, what's missing for your field (wet lab, computational, field work…).
- **Improve docs:** setup guides, translations, screenshots.
- **Code:** fix bugs or add features via pull requests.

## Development
```bash
npm install
npm test        # must pass before you open a pull request
npm run build
```
- Database changes go in a **new** file in `netlify/database/migrations/` (never edit one that has been released).
- Every API route must check permissions on the server (see `can()` / `requirePerm()` in `netlify/functions/api.mjs`). Hiding a button is not access control.
- Add or update tests in `tests/api.test.mjs` for any behavior you change.
- Keep pull requests focused, and explain the user-facing change in the description.

## Security
Please don't report security vulnerabilities in public issues. Email the maintainer (see [SECURITY.md](SECURITY.md)) with details and steps to reproduce.
