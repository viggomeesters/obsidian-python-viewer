# Contributing

Python Viewer is a small read-only inspection plugin. Keep changes focused on local rendering, symbol extraction, fixtures, tests, and documentation.

Before submitting a change, run:

```bash
npm run build
npx tsc --noEmit
npm test
```

Avoid adding runtime network access, clipboard access, file mutation, subprocess execution, code execution, formatters, linters, or IDE-like behavior without a documented design decision.
