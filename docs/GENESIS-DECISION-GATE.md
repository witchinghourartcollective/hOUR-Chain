# hOUR Chain genesis decision gate

Status: proposed recommendations; owner decisions required before a public
testnet with economic value or a mainnet launch.

This document turns the open decisions in ADR-0005 into explicit gates. It
does not freeze tokenomics, validator economics, or production cryptography.

## 1. Token model

The current chain documentation uses `ahbc` as an 18-decimal native denom,
while the separate HOUR ERC-20 and the proposed `whOUR` bridge have a different
role. The chain CLI still inherits several upstream example defaults, so
`ahbc` must not be treated as a final deployed token model yet.

Options to decide:

- Keep a native HBC gas/staking asset and keep HOUR as a separate bridged
  ecosystem token.
- Make HOUR the single economic asset on both networks, and specify how the
  Cosmos bank denom, EVM representation, fees, and bridge supply relate.
- Keep all testnet balances faucet-only with no market value, and defer the
  production asset model until the creator pilot and security review.

**Recommendation:** use a faucet-only testnet denom; do not assign market
value or launch economics to it. Before mainnet, prefer one canonical
economic asset unless a documented product requirement justifies two. Record
the relationship between the Base HOUR supply, the hOUR Chain representation,
IBC vouchers, and any native fee/staking denom before deploying contracts.

## 2. Validator model

Options include a permissioned validator set, open proof-of-stake, or a staged
model that begins permissioned and later opens after operations and economics
are proven.

**Recommendation:** use independent, permissioned operators for a public
testnet and no real rewards. Do not market that testnet as decentralized. A
mainnet PoS decision requires the token decision plus explicit validator
admission, minimum stake, rewards, slashing, unbonding, governance, key
rotation, and incident-recovery rules.

## 3. Post-quantum requirement

The accepted protocol requirement says post-quantum authorization is required
from genesis, but the selected Cosmos/CometBFT stack currently uses Ed25519
validator keys and secp256k1 EVM accounts. The ML-DSA event-signature profile
does not replace either consensus or EVM transaction authorization.

**Recommendation:** keep the disclosure strict and do not claim end-to-end
post-quantum security. Treat the current stack as an experimental devnet. A
public testnet may proceed only if its scope explicitly permits conventional
consensus/account keys and ADR-0002 is revised to make that a staged,
non-production exception. Otherwise, PQ consensus/account authorization is a
hard blocker, not a documentation checkbox.

## 4. Testnet gate

Before calling a network a public testnet, require:

- A multi-operator validator set with documented key custody and recovery.
- Reproducible genesis, binaries, upgrades, snapshots, and restart procedures.
- A successful two-chain ICS-20 transfer, including acknowledgement,
  timeout, and refund tests.
- Public RPC behind rate limits and abuse controls; validator P2P separated
  from administrative and signing interfaces.
- Resource and recovery evidence over a sustained run, not a single healthy
  process check.
- Clear faucet-only asset and PQ-risk disclosures.

## Owner decisions (recorded 2026-10-20)

1. **Token model: faucet-only now, HOUR-as-single-asset is the target.**
   No market value or launch economics on the current testnet. The
   long-term direction is HOUR (not a separate HBC denom) as the one
   canonical economic asset across Base and hOUR Chain. See
   [Target token relationship](#target-token-relationship-hour-as-the-single-asset)
   below for what that requires before it can be deployed; `ahbc` stays an
   unpriced placeholder denom until that design is finished.
2. **Validator model: staged.** Start with permissioned, independently
   operated validators and no real rewards (not marketed as
   decentralized). Build the open-PoS admission criteria (stake minimum,
   rewards, slashing, unbonding) now so the network can open up later
   without a second redesign. See
   [Staged validator path](#staged-validator-path) below.
3. **Post-quantum requirement: kept as a hard blocker.** No public
   testnet — regardless of token or validator readiness — until hOUR
   Chain has actual PQ-capable authorization on validator consensus keys
   and EVM account keys, not just the existing ML-DSA event-signature
   layer. ADR-0002 is not revised. See
   [PQ unblock plan](#pq-unblock-plan) below for what closes this gate.

## Target token relationship (HOUR as the single asset)

Not yet specified — this is new design work, not an existing decision.
Before HOUR (rather than a separate `ahbc`/HBC denom) can be the chain's
native gas/staking asset, this document needs an owner-reviewed answer
for each of:

- How Base `HourToken` supply (mainnet `0xFC1c0FFF99845676A588CE21c28C4859F3035866`)
  maps to hOUR Chain's native bank denom — 1:1 via the existing
  `HourBridgeVault`/`WrappedHour` bridge (ADR-0007), or a separate
  issuance.
- Whether the bridged `whOUR` ERC-20 (devnet:
  `0x3D641a2791533B4A0000345eA8d509d01E1ec301`) and the native bank denom
  are the same asset (via `x/evm` precompile / ERC-20 module pairing) or
  two representations that need their own peg logic.
- Whether gas and staking are paid in the same denom as the bridged
  asset, or whether a thin native gas denom survives alongside HOUR for
  fee-market stability (the ADR-0007 bridge is explicitly **not**
  trust-minimized — no light client, no fraud proof — so staking the
  chain's security on a multisig-bridged supply needs its own risk
  review before it's treated as load-bearing).
- IBC voucher treatment: whether `ibc/...` vouchers of bridged HOUR get
  unwrapped to the native denom automatically or require a separate
  claim step.

This is tokenomics/design work, not a code task — flag for review once
drafted rather than deploying contracts against it.

## Staged validator path

Phase 1 (now): permissioned, independently operated validators, no
rewards, explicit "not decentralized" disclosure on any public-facing
testnet description.

Phase 2 (prep now, activate later) needs, before it can open:

- Minimum stake amount and bond denom (depends on the token decision
  above — can't be priced in `ahbc` if `ahbc` isn't the final asset).
- Admission criteria for new validators (self-bond minimum, commission
  bounds, uptime/slashing conditions).
- Slashing conditions (double-sign, downtime) and unbonding period.
- Validator-set governance: how new validators get admitted to a
  previously-permissioned set without a hard fork.
- Key rotation / incident recovery procedure for validator operators
  (ties into HBC-010, still an open tracking issue).

## PQ unblock plan

What currently exists: an ML-DSA event-signature profile for protocol
events (ADR-0002 follow-up item, prototyped). What's missing and
gates any public testnet:

1. Validator consensus authorization still signs blocks with Ed25519
   (CometBFT default) — no PQ consensus signature scheme is wired in.
2. EVM accounts (bridge signers, user transactions) still authorize with
   secp256k1 — no PQ or composite conventional+PQC EVM account scheme
   exists yet.
3. ADR-0002's own follow-up list (benchmark PQC costs, define signature-
   suite registry, independent cryptographic review) is still open.

Unblocking this is a research/engineering track, not a config change —
treat it as its own workstream with its own timeline rather than a
blocker to resolve inline while pushing for "public and live."
Reasonable next step: scope (1) and (2) as separate spikes — CometBFT's
validator signing interface vs. a custom composite EVM account scheme —
and get a rough effort estimate before committing a date to "public
testnet."
