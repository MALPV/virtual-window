# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button in this repository's Security tab. Do not open a public issue.

Include what you found, how to reproduce it and the impact you expect. You will get an acknowledgement as soon as a maintainer sees it, and credit in the release notes if you want it.

## Supported versions

Only the latest release receives security fixes.

## Security model

- The web view runs under a strict Content Security Policy: no inline scripts, no remote code, no network access.
- All network requests are made by the Rust backend, over HTTPS only, to a fixed set of providers. Responses are parsed and validated before use.
- Scenes are bundled at build time. The app never downloads or executes code at runtime.
- The front end is granted the minimum Tauri permissions (core defaults plus window dragging). Data it sends to native menus is validated in Rust.

Reports that would break any of these properties are especially welcome.
