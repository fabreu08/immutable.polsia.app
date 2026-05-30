# IQC Alpha - Project State Snapshot (as of latest work)

## Current Status
- Seeding works (Instruments + Reviewers populated)
- Submit form creates DB records (readings + QC packets)
- On-chain commits are attempted against **V2 Registry**

## Deployed Contracts (Base Sepolia)

**Active (recommended for new activity):**
- IQCRegistryV2: 0x80c00E40DF46E36652319662929a49bCaeBE52A3
- IQCToken:      0x6D3a4fb7D139d6bb2F241D7F5842955b9d747a4C

**Legacy (contains older stakes, e.g. ~5009 IQC):**
- Original IQCRegistry: 0x35259312d419Fad651a376a737Cb1b5666602E9E

## Key Repos

- Contracts + monorepo work: https://github.com/fabreu08/iqc-alpha (branch: feat/web-app-integration)
- Live web app: https://github.com/fabreu08/immutable.polsia.app

## Important Notes

- The frontend now defaults to V2 for staking, unstaking, and on-chain commits.
- Schema drift fixes have been added to both migrate.js and runtime ensureTables().
- The staking portal at /staking has the best UX for managing stake and viewing history.
- Use "Clear build cache and deploy" on Render when pushing frontend changes.

## How to Continue Later

1. Pull latest from both repos.
2. Redeploy the web app (clear cache recommended).
3. Run migrations on the database if needed.
4. Verify your staked balances on both registries using the /staking page.

Last updated: May 2026
