# Delivery verification record

**Verification date:** 2026-08-06

## Toolchain used

```text
Node.js    v22.16.0
npm        10.9.2
TypeScript 5.8.3
Chromium   144.0.7559.96
```

## Final commands

```bash
npm run verify
npm run build
```

Results:

```text
Strict TypeScript check: passed
Automated tests:        15 passed, 0 failed
Production build:       passed
Output directory:       dist/
```

## Static-server check

The built-in server returned HTTP `200` with the expected content type for:

```text
/
/styles.css
/assets/main.js
/assets/app/App.js
/favicon.svg
```

The `npm run dev -- --host=127.0.0.1 --port=4174` path was also exercised and performed a clean build before serving successfully.

## Browser runtime check

Headless Chromium evaluated the built ES-module graph using the in-memory transport and rendered the home view with no page errors or console errors.

A second rendered-browser flow exercised the complete captain onboarding path:

1. opened `#/create`;
2. generated and retained a version-1 ephemeral identity;
3. entered a normal `npub`;
4. found a seeded, correctly signed kind-`0` profile;
5. copied that complete profile under the ephemeral key;
6. entered demo-day and project details through the rendered forms;
7. created the captain-owned session and ordinary captain participant entry;
8. navigated to the resulting `naddr` session route.

The browser observed one session, one entry, identity version `1`, and published event kinds `[0, 0, 30078, 30078]`, with no page or console errors. The final session view was also captured and visually inspected; avatar sizing and session/project layout were corrected before the final verification run.

Direct Chromium navigation to local HTTP/file URLs was blocked by the execution environment's administrator policy. HTTP serving and browser module/rendering behavior were therefore verified separately, as described in `TESTING.md`. The blob-origin browser harness supplied a deterministic SHA-256 bridge because opaque blob contexts do not expose the secure-context Web Crypto digest API; the application's secp256k1/BIP-340 implementation and event hashing are independently covered by the Node test suite.

## Not exercised against third-party live services

The verification did not publish test events to public relays, request a real LNURL invoice, send a Lightning payment, or wait for a live kind-`9735` receipt. Those checks require deployment-origin network access and real participant/payment metadata; they remain in the operational checklist rather than the deterministic automated suite.
