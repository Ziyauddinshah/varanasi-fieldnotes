# Varanasi Fieldnotes

A responsive tourism blog for international visitors to Varanasi, with an editorial design and a protected publishing dashboard.

Live website: https://varanasi-fieldnotes.happymatch.chatgpt.site

## Features

- Travel stories with category filters and article views
- Interactive three-day itinerary and international visitor essentials
- Admin dashboard with image uploads, drafts, publishing, editing, and deletion
- Offers and travel updates with expiry dates and information links
- Persistent content and images stored in Cloudflare R2
- Server-side admin login, password hashing, secure session cookies, sign-out, and login attempt limits
- Existing owner sign-in through the Sites platform remains supported

## Build and test

Requires Node.js 22 or later. No third-party packages are required.

```sh
npm run build
npm test
```

The build embeds assets from `public/` and writes a Cloudflare Worker ES module to `dist/server/index.js`.

## Source layout

- `public/`: blog, dashboard, login page, styles, scripts, and photographs
- `worker/index.js`: public content API, admin actions, and asset delivery
- `worker/auth.js`: password verification, sessions, and owner authorization
- `scripts/build.mjs`: dependency-free Worker build
- `tests/`: server-side regression checks with mocked storage
- `.openai/hosting.json`: current Sites project and R2 binding configuration

## Hosting configuration

The current website is hosted through Sites. Its manifest binds R2 storage as `BUCKET`. The Worker expects the R2 API (`get`, `put`, `head`, `list`, and `delete`). Articles, uploads, sessions, and login attempt records are persisted there. Runtime content and credentials are not included in this repository.

Set `ADMIN_PASSWORD_HASH` as a server-side secret. Its format is `salt:hash`, where the hash is a 32-byte PBKDF2-HMAC-SHA256 result, with 100,000 iterations and a UTF-8 salt; both salt and hash are represented as strings, with the hash encoded in hexadecimal. The configured username is `Admin`; the password itself is never embedded in the client or source. Session cookies expire after eight hours.

Sites supplies trusted `oai-authenticated-user-id` and `oai-authenticated-user-email` headers for owner sign-in. If adapting this project to another host, replace this integration with trusted authentication and configure the owner authorization in `worker/auth.js`. Do not trust these headers from untrusted clients on other hosts.

For a separate Sites deployment, replace the existing project identity with your own project ID. Set the runtime secret and storage binding before deploying the built Worker. The repository itself does not change or automatically deploy the existing live website.

## Photography

Photograph attributions and license links are included in the website's Photography credits section in `public/index.html`. Preserve those credits when reusing the images. Food photography is sourced from Unsplash.

## Verification

Tests cover authorization, CSRF, draft visibility, publishing and unpublishing, offer expiry, upload validation, link validation, deletion, login, session protection, logout, and attempt limits. Browser-based tests are not included.

## Production operations

- **Set a strong admin password:** open `/admin`, expand **Change admin password**, enter the current password and a new unique passphrase of 14–128 characters. A successful change revokes existing password sessions. The salted verifier is stored privately in R2 at `auth/credentials`, superseding the initial environment secret. The owner can still use Sites sign-in. Do not use the original demonstration password for production.
- **Export content:** the dashboard's **Export articles (JSON)** link downloads articles, drafts, metadata and image URLs. This is a content export, not a complete media backup; retain separate copies of original uploads and use storage-level backups for a complete recovery plan.
- **Monitoring:** `/healthz` is a basic liveness endpoint. Monitor `/api/posts` as well to exercise the content store. Configure external uptime/error monitoring in your hosting operations; the repository does not provision a monitoring service.
- **Publishing:** new articles have permanent `/journal/<id>` URLs, escaped server-rendered content, canonical/Open Graph metadata and sitemap entries. Drafts and expired articles return 404 at their public URLs. The sitemap is at `/sitemap.xml`; admin/API routes are excluded from search indexing.
- **Concurrent editing:** updates check the article version and use R2 conditional writes. Stale saves/deletes return 409 instead of silently replacing newer content. Deletion checks the current version but is not a multi-operation transaction.
- **Bounded input:** JSON and upload bodies are streamed with hard size limits even without `Content-Length`; file signatures, fields, dates and external links are validated. Only the trusted owner or authenticated admin can mutate content.
- **Login throttling:** R2 stores attempt counters per source IP. This is best-effort throttling, not an atomic distributed rate limiter. For a high-traffic or actively attacked deployment, also configure an edge/WAF rate-limit rule for `/api/auth/login` and a storage lifecycle policy for old session/attempt objects. Never expire `auth/credentials` with that policy.
- **Scale:** the content API reads R2 article documents in batches and sorts them for a small editorial blog. For a large archive, migrate listings to an indexed database with pagination.
- **CI:** GitHub Actions builds the Worker, runs server regression tests and validates JavaScript on pull requests and pushes to `main`. CI does not automatically deploy production.

The platform must provide HTTPS, strip untrusted identity headers and inject trusted Sites identity. Security response headers are added centrally. Do not put this Worker directly on another host without replacing that identity integration.

Browser/device QA and accessibility audits are still needed before a broad public launch. The automated checks here test server behavior, not real browser rendering. Hotel examples and exchange rates are static, dated planning references; review them regularly rather than presenting them as live availability.
