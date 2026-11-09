# Changelog

## Unreleased

- Publish with public npm access and verify registry metadata and installed consumers without a read token. Keep protected OIDC publishing and exact archive-integrity checks.

## 0.3.0

- Make ConfigService container-independent and remove Inversify and reflect-metadata from runtime dependencies.
- Replace automatic service construction with explicit container bindings; consumers using `.toSelf()` must migrate to a factory or an existing instance.
- Verify container-free consumers and consumer-owned Inversify 6, 7 and 8 without changing configuration loading or reader APIs.
- Preserve private npm access during publication and authenticate registry verification with a separate read credential.

- Match release readiness checks to Yarn's registry requests and retry installation
  only when the newly published version is still unavailable. Keep registry
  consumer caches isolated and fail immediately on other installation errors.

## 0.2.0 - 2026-10-16

Initial standalone release of `@gaia-framework/config`.

- Synchronous layered YAML and TOML loading, explicit file selection and deep merges.
- Environment overrides, placeholders, fallbacks, escaping and scalar coercion.
- `$env`, `$file` and mixed YAML/JSON/TOML `$include` directives with fragments.
- Required and optional typed getters, literal key paths and key enumeration.
- Application-owned schema validation and Inversify service integration.
- Optional strict inputs, isolated environments, immutable snapshots and safe errors.
- Compiled ESM exports, TypeScript declarations, documentation and runnable examples.
