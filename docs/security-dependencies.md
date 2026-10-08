# Dependency security review

Review date: 2026-10-09. Scope: checked-in lockfiles and current local-development/browser application. Audit counts identify package/advisory matches, not demonstrated exploits. Recheck them before publication or any broader deployment.

## Changes made

Frontend: Vite 5.4.21 → 6.4.4 (patched development-server line), React Router DOM 6.30.3 → 6.30.6, and compatible updates of Babel/browser data and selector-parser dependencies. No `npm audit fix --force`, Tailwind migration or router architecture rewrite was used. Exact resolved versions are in `frontend/package-lock.json`.

`npm audit` went from 15 affected packages (8 high) to **9 affected packages: 5 high, 4 moderate, 0 critical**. Several reports refer to the same vulnerable transitive package. A zero-advisory claim would be false.

Backend: the formerly ignored `uv.lock` is now tracked. Eight affected packages were specifically refreshed: anyio 4.14.2, cryptography 50.0.2, idna 3.20, Mako 1.4.3, pyasn1 0.6.4, pydantic-settings 2.15.0, python-multipart 0.0.32 and Starlette 1.7.0. FastAPI, database libraries, bcrypt and JWT format remain unchanged.

`pip-audit` against the pinned production requirements went from 41 report rows / 23 distinct advisory IDs in 10 packages to **3 report rows / 2 distinct IDs in 2 packages**. The remaining python-ecdsa report appears twice under the same ID. Clean `uv sync --locked`, migrations and backend/browser tests passed with the refreshed lockfile.

## Remaining frontend reports

| Dependency / advisory | Reachability in LifeLog | Decision |
| --- | --- | --- |
| braces ≤3.0.3; propagated through chokidar, fast-glob, micromatch and Tailwind (5 high package reports) | Deeply nested attacker-controlled brace patterns can exhaust a Node stack. LifeLog uses fixed build globs on trusted repository sources, not a user-supplied glob service. These packages are development tooling, absent from the deployed browser runtime. | No upstream patched braces version was listed at review. Keep local/trusted-source build scope; review again when a patch exists. |
| postcss-selector-parser 6.x via postcss-nested (2 moderate package reports) | Synchronously parsing attacker-controlled flat selectors can exhaust CPU. The application does not parse journal/LLM content as CSS; Tailwind compiles repository CSS. A separate 7.x parser branch was updated, but the nested plugin still requires 6.x. | Avoid an unsupported cross-major override or a Tailwind rewrite just to remove a report. Never turn this build chain into an untrusted CSS-processing service. |
| React Router / React Router DOM (2 moderate package reports, 2 underlying advisories) | The backslash redirect advisory requires attacker-supplied navigation targets. Current navigation uses fixed route prefixes and encoded IDs, not a supplied return URL. The other issue concerns SSR error hydration; this app uses client-side BrowserRouter with React createRoot, no SSR. | Kept the compatible patched 6.x line. A 7.18+ migration remains follow-up work; reassess if adding arbitrary navigation destinations or SSR. |

Primary references: [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [selector-parser maintainer advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf), [React Router redirect advisory](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [React Router SSR advisory](https://github.com/advisories/GHSA-337j-9hxr-rhxg). Applicability above is an inference from those conditions and the inspected code, not an upstream exemption.

## Remaining backend reports

- **python-jose 3.5.0, CVE-2026-85394 / GHSA-3qf3-8w2g-rqmx (upstream critical).** Algorithm confusion can occur when DER public keys are treated as HMAC secrets and algorithms are not restricted. LifeLog decodes with an explicit single configured algorithm, defaults to HS256 with a private random symmetric secret, and has no public-key/JWKS workflow. A negative regression verifies that a token's alternative algorithm is rejected even when signed with the same secret. No upstream patched release was listed. This is a conditional risk assessment, not a claim that python-jose is vulnerability-free. Review or replace the library before introducing asymmetric keys or public hosting. [Advisory](https://github.com/advisories/GHSA-3qf3-8w2g-rqmx).
- **python-ecdsa 0.19.2, CVE-2024-23342 / GHSA-wj6h-64fc-37mp.** Timing leakage affects EC signing/key generation; signature verification is excluded by the advisory. LifeLog's documented HS256 flow does not use EC signing. The package remains a python-jose dependency; no patched version is planned upstream. Reassess if adding EC operations. [Advisory](https://github.com/advisories/GHSA-wj6h-64fc-37mp).

## Reproduce the review

From `frontend/`:

```sh
npm ci
npm audit
npm audit --omit=dev
```

From `backend/`, with uv and pip-audit available:

```sh
uv sync --locked
uv export --locked --no-dev --no-hashes --no-emit-project --output-file /tmp/lifelog-audit-requirements.txt
pip-audit --no-deps --disable-pip -r /tmp/lifelog-audit-requirements.txt
```

A nonzero audit exit code remains expected while the above advisories remain. Audit results change with advisory databases. No paid model calls were made during verification; package/advisory downloads do not evaluate provider integration.
