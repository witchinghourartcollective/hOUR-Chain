# Independent cryptography review packet

Status: prepared for an external reviewer; no independent review has been
completed. Do not cite this packet as an audit or security certification.

## Review request

Perform an adversarial, implementation-level review of the experimental
ML-DSA-65 paths used by hOUR Chain. Report exploitable defects, consensus or
authorization failure modes, unsafe assumptions, and conditions that must be
met before a public testnet. Reviewers should be independent of the authors of
the hOUR Chain integration, the two Cosmos forks, and the deployed verifier.

## Scope

1. **CometBFT consensus key integration:** key generation and persistence,
   sign/verify behavior, validator address derivation, vote/proposal/commit
   serialization, proto codec compatibility, signature-size limits, and
   behavior on malformed or unknown key types. Review the CometBFT fork's
   `mldsa65-consensus` branch and the Cosmos SDK fork pinned by `chain/go.mod`.
2. **Consensus operations:** key import, backup, rotation, recovery, double-sign
   protection, restart behavior, and compatibility with light clients,
   explorers, relayers, and other stock CometBFT tooling.
3. **PQC event signatures:** canonical encoding, domain separation, chain and
   event binding, replay resistance, key identifiers, parsing limits, and
   algorithm/version migration in `packages/pqc-profile`.
4. **Checkpoint attestations:** validator-set source, voting-power quorum
   calculation, exact threshold edges, stale/forked header handling, chain and
   height binding, signature verification, and signer-key custody in
   `packages/pqc-checkpoint` and `deploy/devnet`.
5. **PQC EVM account path:** `PqcAccount` UserOperation validation, verifier
   contract behavior, key setup and rotation, replay protection, gas limits,
   privileged execution paths, and integration with bridge and recovery
   authority. Distinguish the one deployed demonstration from ordinary
   secp256k1 EOAs.
6. **Cryptographic dependencies:** confirm FIPS 204 parameter-set compliance,
   implementation/version provenance, test-vector coverage, side-channel and
   denial-of-service considerations, and the security boundary of the
   `ZKNoxHQ/ETHDILITHIUM` verifier.

## Evidence available

- `docs/GENESIS-DECISION-GATE.md` records the authorization and public-testnet
  gates.
- The 2026-10-28 isolated four-validator run reached a commit with three real
  ML-DSA-65 validator signatures, each 3309 bytes; measured block cadence was
  about five seconds in that small test.
- On 2026-11-02 the live devnet status reported validator key type
  `tendermint/PubKeyMlDsa65`. This is a point-in-time observation, not a soak.
- A real `PqcAccount` UserOperation was created and broadcast on the devnet on
  2026-10-21. The verifier source is explicitly marked experimental and
  unaudited by its authors.
- `GOMAXPROCS=2 go test . -run '^TestICS20TransferAndTimeoutRefund$' -count=1`
  passed locally on 2026-11-01. This covers one hOUR app with an upstream IBC
  test app, including timeout/refund behavior.
- On 2026-11-02, two separate hOUR validator processes opened an unordered
  ICS-20 channel and completed an `atest` transfer A-to-B followed by a full
  voucher return B-to-A. The voucher appeared on B, was burned on return, and
  Hermes reported no pending packets or acknowledgements. This was a temporary
  local smoke test, not a public network test. Hermes 1.13.2 reported SDK
  0.54.3 outside its documented supported range and could not extract headers
  from `UpdateClient` events for misbehaviour checks; timeout/refund was not
  tested between two hOUR nodes.

## Required reviewer deliverables

- Findings ranked by severity with exploit preconditions and affected commits.
- Independent reproduction commands and any failing test or proof of concept.
- A clear distinction between reviewed source, deployed bytecode, and live
  configuration.
- Explicit limits on what the review does not establish, including external
  Base/Solana/Lightning security and bridge trust assumptions.
- A retest recommendation after fixes; commissioning a review or receiving a
  report does not by itself close the public-testnet gate.
