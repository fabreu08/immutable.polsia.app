# Immutable QC — Instrument-to-Ledger MVP

## What this app does

Immutable QC captures measurement data from laboratory instruments (pH meters, temperature probes, HPLC chromatographs), cryptographically signs each reading with ECDSA, commits it to a hash-chain blockchain ledger, and routes it through a reviewer attestation workflow for quality control and compliance.

## Stack

Express.js + EJS + Neon PostgreSQL on Render.

## Directory map

```
db/           — PostgreSQL queries (one file per entity, Pool in index.js)
routes/       — Express route handlers (REST API + page renders)
services/     — Business logic: crypto signing, ledger chain, QC packets, HPLC parsing, IQC contract queries
views/        — EJS page templates (layout.ejs + dashboard/readings/ledger/review/submit)
migrations/   — DDL SQL files (timestamped, run via migrate.js)
public/css/   — Landing page stylesheet
public/js/    — Client-side JavaScript (wallet connector, analytics tracker)
lib/          — Landing page context builder
jobs/         — Scheduled jobs (ledger health, QC digest)
```

## Database

| Table | Stores |
|-------|--------|
| instruments | Registered sensor instruments (pH, temperature, hplc) |
| readings | Captured measurements with ECDSA signature, chain hash, and optional HPLC metadata JSONB |
| qc_packets | Quality control packets wrapping readings for review |
| reviewers | Authorized attestors (qc_analyst, lab_manager, qa_director) |
| attestations | Audit trail of reviewer actions on QC packets |
| ledger_entries | Blockchain blocks: block hash, merkle root, previous hash |
| wallet_attestations | EVM wallet signatures on QC packets (address, chain, sig) |
| demo_requests | Early access / demo request submissions (name, email, company) |
| analytics_events | Product analytics: page views, button clicks, wallet connections, CSV uploads, demo requests (JSONB properties) |
| faucet_requests | IQC testnet token faucet dispenses (wallet address, IP, amount, timestamp) |

## External integrations

- **Stripe**: Not yet active (owner identity verification pending)
- **OpenAI**: Not yet active
- **R2**: Not yet active
- **Neon PostgreSQL**: Primary data store (DATABASE_URL via env)
- **Render**: Hosting platform
- **EVM Wallets**: MetaMask / injected wallet via ethers.js v6 (CDN, client-side). ethers.js v6 backend for IQC contract queries. IQC token on Base Sepolia: `0x5a1014b0221ee57078f5d63e32c841834464d2f9`

## Recent changes

- 2026-05-24 — Added on-chain attestations section to /ledger page: queries AttestationCreated events from IQC token contract on Base Sepolia, displays TX hash/block/timestamp per record with Basescan links. GET /api/ledger/on-chain-attestations endpoint. services/iqc-contract.js.
- 2026-05-24 — Added on-demand IQC testnet faucet: POST /api/faucet sends 0.1 IQC per request (1hr cooldown per address+IP), faucet_requests table, "Request Test Tokens" button on submit page when wallet balance is low.
- 2026-05-24 — Fixed Sign & Submit button: now triggers MetaMask wallet connection before submitting. Added faucet banner for wallets with insufficient IQC balance.
- 2026-05-24 — Added /pricing page with Open Alpha (free) and Pro (waitlist) tiers. Demo request form posts to /api/demo-request, stored in demo_requests table. Pricing nav link added to landing page nav.
- 2026-05-23 — Added HPLC CSV parser and QC Packet integration. Waters Empower and Agilent OpenLAB CSV upload at /api/hplc/upload, auto-instruments registration, measurement_metadata JSONB on readings, "Upload HPLC CSV" tab in submit page.
- 2026-05-23 — Added MetaMask / multi-chain EVM wallet connector. Connect Wallet button across all pages, on-chain QC packet signing via EIP-191, wallet_attestations table, /api/wallet route. ethers.js v6 from CDN.
- 2026-05-23 — Built instrument-to-ledger MVP: ECDSA-signed readings, hash-chain ledger, QC packet attestation flow, full dashboard UI. Routes: instruments, readings, qc-packets, reviewers, ledger. DB tables: instruments, readings, qc_packets, reviewers, attestations, ledger_entries.