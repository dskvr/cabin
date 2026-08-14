# Technology Stack

**Analysis Date:** 2026-08-14

## Languages

**Primary:**
- TypeScript (ES2022) - browser application, domain logic, Nostr protocol and cryptography in `src/`

**Secondary:**
- JavaScript ES modules - build, development server, and test runners in `scripts/`
- HTML/CSS - static shell and styling in `public/index.html` and `public/styles.css`

## Runtime

**Environment:**
- Node.js >=20.19 for build, serve, and tests (`package.json`)
- Modern browser runtime for the application (`DOM`, `WebSocket`, `localStorage`, Web Crypto APIs)

**Package Manager:**
- npm
- Lockfile: present (`package-lock.json`)

## Frameworks

**Core:**
- No application framework; vanilla TypeScript with `DemoDayApp` in `src/app/App.ts`
- Node built-in HTTP server for local serving (`scripts/serve.mjs`)

**Testing:**
- Node built-in test runner, invoked by `scripts/test.mjs`

**Build/Dev:**
- TypeScript 5.8.3 compiler (`tsconfig.json`)
- Custom Node build pipeline (`scripts/build.mjs`)
- Custom watch/preview server (`scripts/serve.mjs`)

## Key Dependencies

**Critical:**
- `gsap` `^3.15.0` - browser animation and ScrollTrigger assets copied during build (`src/ui/motion.ts`, `scripts/build.mjs`)
- `qrcode-generator` `^1.4.4` - QR code generation, bundled as a browser asset by `scripts/build.mjs`

**Infrastructure:**
- No server framework, ORM, database client, or cloud SDK detected.

## Configuration

**Environment:**
- `PORT` and `HOST` optionally configure the local Node server in `scripts/serve.mjs`.
- Relay URLs, Nostr kinds, and browser storage keys are source-controlled constants in `src/config/relays.ts`.

**Build:**
- Strict ES2022 TypeScript configuration in `tsconfig.json`.
- `scripts/build.mjs` compiles `src/` to `dist/assets/` and copies `public/` plus vendored browser assets.

## Platform Requirements

**Development:**
- Node.js >=20.19 and npm; a browser with WebSocket, Web Crypto, localStorage, and DOM support.

**Production:**
- Static hosting of the generated `dist/` directory; no backend process or database is required by the application.

---

*Stack analysis: 2026-08-14*
