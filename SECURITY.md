# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, **please do not open a public GitHub issue**.
Instead, report it privately via GitHub Security Advisories:

1. Go to the [Security tab](../../security/advisories/new) of this repository
2. Click "Report a vulnerability"
3. Describe the issue, reproduction steps, and the affected version

Alternatively, email the maintainers directly (address in repository profile).

You can expect:

- An acknowledgement within **3 business days**
- A triage and severity assessment within **7 days**
- A fix or mitigation timeline communicated based on severity

## Supported Versions

Only the latest release on the `main` branch receives security updates while the project is pre-1.0.

## Security Model

ImapSync Web is designed to be **deployed behind a trusted boundary** (private network, VPN, or HTTPS-terminating reverse proxy with auth). It is **not hardened for direct exposure to the public internet**.

### What is protected

- IMAP passwords are encrypted at rest using **AES-256-GCM**. The key (`ENCRYPTION_KEY`) is never written to the database.
- Admin sessions are signed JWTs (HS256, via [`jose`](https://github.com/panva/jose)) stored in `httpOnly`, `Secure`, `SameSite=Lax` cookies.
- The admin password is stored as a `bcrypt` hash (cost 12).
- All non-`/login` routes are gated by middleware (`src/proxy.ts`).

### Known limitations

- **No login rate limiting.** Run behind a reverse proxy with brute-force protection (fail2ban, Cloudflare, etc.) if exposed.
- **Single admin account.** No multi-user / RBAC support yet.
- **No audit log** of admin actions.
- The runner spawns the `imapsync` binary directly. Anyone with admin access to the UI can configure arbitrary `imapsync` arguments — treat the admin login as full server access.

### Operator responsibilities

- Set strong, unique values for `ENCRYPTION_KEY`, `JWT_SECRET`, `ADMIN_PASSWORD`, and `DB_PASSWORD` (the application refuses to start with weak or missing values).
- Rotate `ENCRYPTION_KEY` only with planned re-encryption — changing the key invalidates all stored IMAP passwords.
- Keep the deployment behind HTTPS in production.
- Back up the `pgdata` volume regularly.
