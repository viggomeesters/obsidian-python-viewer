# Security Policy

## Supported versions

Only the latest release is actively supported.

## Reporting a vulnerability

Please report security issues privately by emailing the maintainer or opening a minimal GitHub security advisory if available.

Do not include sensitive vault content in public issues. If a reproduction requires Python code, reduce it to a minimal synthetic example first.

## Security posture

Python Viewer is read-only. It reads `.py` files through the vault API and renders local source and structure views. It does not send vault content to external services, does not use runtime network APIs, does not read or write the system clipboard, does not run Python code, and does not write Python files back to disk.

The v0.1 parser is a lightweight local symbol parser. It is intended for inspection and navigation, not for executing code, linting, formatting, type checking, or refactoring.
