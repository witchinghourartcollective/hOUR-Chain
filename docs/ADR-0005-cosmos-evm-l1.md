# ADR-0005: hOUR Chain as a Cosmos SDK L1 with EVM compatibility

Status: Accepted (2026-10-12)
Supersedes: [ADR-0004](ADR-0004-solana-consent-base-payments.md)
Amends: [ADR-0001](ADR-0001-phase-1-settlement.md) (settlement network)

## Context

ADR-0004 put consent/attestations on Solana and payments on Base. After a
meeting with Chainlink, Witching Hour Music decided hOUR Chain should be its
own L1 so that consent, attestations, and settlement share one chain with
IBC connectivity. No hOUR chain code existed yet (only specs and a
post-quantum signing package), so switching now is cheap.

## Decision

1. **hOUR Chain is a sovereign Cosmos SDK L1 with EVM compatibility**, built
   on `cosmos/evm` v0.7.0 (Cosmos SDK v0.54, CometBFT v0.39, ibc-go v11).
2. **IBC is the native interoperability layer.**
3. **EVM JSON-RPC is exposed** so Solidity contracts and EVM wallets work.
4. Devnet identifiers: Cosmos chain-id `hour_9000-1`, EVM chain id `9000`,
   base denom `ahbc` (18 decimals, display `hbc`). Not final for mainnet.
5. Filecoin remains the durable evidence/archive layer; Lightning remains a
   planned adapter.

## Open decisions

- **Token model:** supply, issuance, fee token, and whether `ahbc` is staked.
- **Validator model:** permissioned/PoA vs. open PoS, set size, slashing.

## Caveats

- **Chainlink CCIP does not support Cosmos/IBC chains.** Routes: ask Chainlink
  to onboard HBC as an EVM chain (via cosmos/evm JSON-RPC), or reach CCIP
  through Base (e.g. IBC/bridge to Base, then CCIP from Base).
- **Post-quantum disclosure (ADR-0002):** CometBFT validator keys (Ed25519)
  and `eth_secp256k1` account keys are not post-quantum. Until PQ validator and
  account signature suites exist, hOUR Chain MUST NOT claim end-to-end
  post-quantum security, and verifiers MUST report the consensus and account
  layers as quantum-vulnerable, separately from any ML-DSA event signatures.

## Status of implementation (2026-10-12)

- `chain/`: scaffold from the `cosmos/evm` v0.7.0 `evmd` example (binary
  `hourd`), single-node devnet via `chain/devnet.sh`. Not audited, not deployed.

## Consequences

- `hour-chain-solana` work is paused; README/SPEC chain-role wording must be
  updated to point at this ADR.
- Estimated 3–6 months for one or two Go engineers to reach a testnet.
