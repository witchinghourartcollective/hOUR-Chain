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

## Reviewer terms

This is currently an unpaid, best-effort engagement, not a billable audit. The
terms below exist so a prospective reviewer knows exactly what they're
agreeing to before they start, and so there's no ambiguity about disclosure
once they find something.

**Disclosure.** `hOUR-Chain` and its `cometbft`/`cosmos-sdk` forks are already
public on GitHub, so this is not a confidentiality NDA over secret code —
there's nothing to keep secret. What it governs is *timing*: findings go to
the hOUR Chain team privately first. We commit to acknowledging receipt
within 5 business days and to a good-faith fix-or-respond on Critical/High
findings within 30 days of acknowledgement. The reviewer may publish their
own report publicly 30 days after we acknowledge receipt, or immediately once
we've shipped a fix/response to the specific finding — whichever comes
first. This protects users from an unpatched public writeup while still
giving the reviewer a guaranteed, bounded path to publish under their own
name.

**Timeline.** Best-effort, not a contractual SLA: propose a 4–6 week review
window from acceptance, with one informal check-in near the 2-week mark. No
deadline is enforced against the reviewer — this is explicitly unpaid, so
we're asking for their time, not buying it on a schedule.

**Compensation.** There is no audit budget right now. What's offered instead:
full public credit as the project's first independent reviewer, in this
document and in any published writeups; the unrestricted right to publish
their own findings/writeup under their own name once the disclosure window
above closes; and first right of refusal on a paid follow-up review if/when
the project secures funding (token allocation or USDC — intent stated, not
promised). A reviewer who needs paid work should expect this to be a pass,
and that's a reasonable call on their part.
