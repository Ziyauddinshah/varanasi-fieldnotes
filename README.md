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
