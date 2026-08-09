# ProofOps visual assets

All assets in this directory are committed release evidence.

## Product art

`../app/dashboard/assets/proofops-flight-recorder.webp` is the original
abstract Incident Flight Recorder artwork generated for this project. It uses
the product palette—abyss blue, telemetry cyan, and audit copper—and contains no
third-party marks or embedded text.

## Diagram

`proofops-overview.svg` is a repository-authored architecture diagram. It is
safe to embed in the README, submission page, or demo video.

## Browser captures

The six PNGs under `screenshots/` are created by the deterministic real-browser
acceptance test in `tests/browser/proofops.spec.py`.

```bash
corepack pnpm run test:browser
```

The test launches Chromium, exercises desktop and mobile layouts, rejects an
unauthenticated mutation, checks keyboard order and reduced motion, builds and
approves a fixture proposal, downloads the proof, and confirms fixture evidence
does not expose external transaction links.

Screenshots are product demonstrations, not live transaction evidence.
