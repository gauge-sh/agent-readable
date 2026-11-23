# Security

Do not open a public issue containing credentials, private site content, or an exploitable vulnerability. Use GitHub's private vulnerability reporting for this repository when enabled. If it is unavailable, open a minimal issue asking a maintainer to enable a private reporting channel, without vulnerability details.

Only the latest release receives fixes. This package is pre-1.0; use a pinned version and review upgrade notes.

The build command and configuration are trusted project inputs. Do not run setup commands supplied by untrusted users. This package is not an HTML sanitizer or a security boundary. Only provide an export intended for public deployment: excluded and noindex pages are omitted from Markdown, but their original static files are still copied. Do not expose private exports through this tool.

Symlinks in export paths and output paths are rejected. The URL checker contacts the origin you supply and follows only same-origin redirects; do not expose it as an unauthenticated network service. It is intended as a maintainer CLI, not a hardened crawler for hostile inputs.
