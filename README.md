# IQC Alpha Web App (Express)

This is the full-stack alpha web application for Immutable Quality Control.

It powers `alpha.immutableqc.com` and provides:
- Instrument reading capture (manual + HPLC CSV upload)
- ECDSA-signed readings + hash-chained ledger
- QC packet creation + reviewer attestation workflow
- EVM wallet connection (MetaMask) + on-chain commitments to the IQCRegistry on Base Sepolia
- Faucet for testnet IQC tokens
- Analytics + demo request collection

## Relationship to the rest of the repo

- `../contracts/` + Hardhat scripts: The canonical IQC smart contracts (`IQCToken` + `IQCRegistry`)
- This `web/` directory: The production Express application that interacts with those contracts
- `../frontend/`: Early Next.js marketing shell (separate from this app)

## Key recent changes (ported)

- Corrected on-chain submission to use the real deployed `IQCRegistry` ABI:
  - `commitQCPacket(string instrumentId, string dataHash)`
  - Requires prior staking of ≥1 IQC
- Added `getStakedBalance()` client helper
- `public/js/wallet.js` now properly calls the live Registry at `0x35259312d419Fad651a376a737Cb1b5666602E9E`
- Wallet attestations are recorded both on-chain and in the `wallet_attestations` table

## Directory map

```
web/
  server.js
  routes/           API + page routes (readings, qc-packets, wallet, ledger, etc.)
  db/               PostgreSQL query modules (one per entity)
  views/            EJS templates (dashboard, submit, review, ledger, etc.)
  services/         Business logic (crypto, ledger, qc-packet, hplc-parser, iqc-contract)
  public/           Static assets + client JS (wallet.js is the key integration point)
  lib/
  jobs/
  migrate.js        Database migration runner
  render.yaml       Render.com deployment config
```

## Local development

```bash
cd web
npm install

# Run migrations (requires DATABASE_URL)
DATABASE_URL="postgresql://..." node migrate.js

# Start the server
DATABASE_URL="postgresql://..." npm run dev
```

The app listens on `PORT` (default 3000).

## On-chain requirements (Base Sepolia)

To successfully call `commitQCPacket` from the UI:
1. Wallet must be on Base Sepolia (chain 84532)
2. The connected address must have staked at least 1 IQC to the Registry contract

Use the Hardhat scripts in the repo root or add a staking helper in the UI for test wallets.

## Deployment

Currently deployed to Render (alpha.immutableqc.com) via `render.yaml`.

The app expects:
- `DATABASE_URL` (Neon Postgres)
- Other optional env vars for Stripe, OpenAI, R2, etc. (not yet active)

## Continuity notes

Full project history and architecture decisions are in `web/CLAUDE.md` (brought over from the original development session). The contracts live in the sibling `contracts/` directory at repo root.

This structure was created during the `feat/web-app-integration` branch to consolidate the previously separate web app repo with the smart contract work.
