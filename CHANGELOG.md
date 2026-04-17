# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-17

Initial public release.

### Added

- Migration jobs grouping multiple IMAP accounts into a single run
- Server presets for IONOS, Strato, mail.de, GMX, Web.de, Gmail, Outlook / Microsoft 365, plus custom hosts
- Live `imapsync` log streaming per account via Server-Sent Events
- Configurable per-job concurrency (1–10) and a global runner cap (`MAX_PARALLEL`)
- Per-job and per-account option overrides (`--subfolder2`, `--exclude`, `--regextrans2`, extra args)
- Scheduling modes: start now, scheduled time, queue group (sequential), or draft
- Draft editing: drafts can be reopened and reworked before being started; existing passwords are preserved when left blank
- Per-account IMAP login test button — verifies source and destination credentials in parallel before the job runs (works on stored draft credentials too)
- CSV import (`source;sourcePass;dest;destPass`) on the new-migration page
- Retry-failed-only flow on completed jobs
- Live dashboard with running, queued, scheduled, and recent jobs
- AES-256-GCM encryption at rest for IMAP passwords
- bcrypt-hashed admin login over a `jose`-signed JWT in an httpOnly cookie
- Fail-fast secret validation in app + runner entrypoints and the admin-init script
- DB-mediated job orchestration with crash recovery for stuck accounts
- Three-container Docker Compose stack (app, runner, db) with shared log volume
- GitHub Actions CI (pnpm build + Docker buildx for both images)

[0.1.0]: https://github.com/FloBaMedia/ImapSync-Web/releases/tag/v0.1.0
