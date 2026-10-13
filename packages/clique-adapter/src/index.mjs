// Clique TEE Network adapter — see docs/ADR-0006-clique-tee-oracle-clob-loyalty.md
//
// Scaffold only: CliqueClient throws until real credentials are configured.
// The build*Event helpers produce hOUR Chain event payloads (not yet signed —
// pass the result to signEnvelope from @hour-chain/pqc-profile).

export const EVENT_TYPES = Object.freeze({
  CLOB_FILL: "hour.clob-fill",
  LOYALTY_REWARD: "hour.loyalty-reward",
  ROYALTY_SETTLEMENT_INSTRUCTION: "hour.royalty-settlement-instruction",
});

export const SUPPORTED_CHAINS = Object.freeze(["solana", "evm-base", "hyperliquid"]);

/**
 * Thin wrapper around @cliqueofficial/clique-client-sdk-node.
 * Not wired to a real account yet — every method throws NotConfiguredError
 * until CLIQUE_API_KEY / CLIQUE_WALLET_ID are set. This is intentional:
 * we do not fabricate network calls against an API we have not integrated
 * against yet. See ADR-0006 "Consequences".
 */
export class CliqueClient {
  constructor({ apiKey = process.env.CLIQUE_API_KEY, walletId = process.env.CLIQUE_WALLET_ID } = {}) {
    this.apiKey = apiKey;
    this.walletId = walletId;
  }

  #requireConfigured() {
    if (!this.apiKey || !this.walletId) {
      throw new NotConfiguredError(
        "Clique is not configured: set CLIQUE_API_KEY and CLIQUE_WALLET_ID. " +
        "Install @cliqueofficial/clique-client-sdk-node and wire this method to it once a real account exists.",
      );
    }
  }

  /** Prove arbitrary off-chain TLS session data via Clique's TLS Oracle. */
  async proveTlsSession(_request) {
    this.#requireConfigured();
    throw new Error("TODO: wire to Clique TLS Oracle (@cliqueofficial/clique-client-sdk-node)");
  }

  /** Place an order on Hyperliquid via Clique Wallet's multi-chain custody. */
  async placeClobOrder(_order) {
    this.#requireConfigured();
    throw new Error("TODO: wire to Clique Wallet REST API (Hyperliquid order placement)");
  }

  async cancelClobOrder(_orderId) {
    this.#requireConfigured();
    throw new Error("TODO: wire to Clique Wallet REST API (Hyperliquid order cancellation)");
  }

  async getBalances(_chain) {
    this.#requireConfigured();
    throw new Error("TODO: wire to Clique Wallet REST API (balances per chain)");
  }
}

export class NotConfiguredError extends Error {}

/** Build (unsigned) hour.clob-fill event payload from a Hyperliquid fill. */
export function buildClobFillEvent({ actor, subject, fill, tlsOracleAttestation, issuedAt = new Date().toISOString() }) {
  if (!fill?.orderId || !fill?.price || !fill?.size) {
    throw new TypeError("fill requires orderId, price, size");
  }
  return {
    eventType: EVENT_TYPES.CLOB_FILL,
    actor,
    subject,
    issuedAt,
    network: "hyperliquid",
    payload: { fill, tlsOracleAttestation: tlsOracleAttestation ?? null },
  };
}

/** Build (unsigned) hour.loyalty-reward event from a TLS-oracle-attested engagement signal. */
export function buildLoyaltyRewardEvent({ actor, subject, signal, rewardAmount, settlementAsset, tlsOracleAttestation, issuedAt = new Date().toISOString() }) {
  if (!signal) throw new TypeError("signal is required");
  if (!(rewardAmount > 0)) throw new TypeError("rewardAmount must be positive");
  return {
    eventType: EVENT_TYPES.LOYALTY_REWARD,
    actor,
    subject,
    issuedAt,
    payload: { signal, rewardAmount, settlementAsset: settlementAsset ?? "HOUR", tlsOracleAttestation: tlsOracleAttestation ?? null },
  };
}

/**
 * Build (unsigned) hour.royalty-settlement-instruction event.
 * trigger: the fact that causes the royalty (a CLOB fill, a loyalty-reward
 * vesting, or an off-chain sale report attested via TLS Oracle).
 * splitGraphRef: reference to the versioned contributor/rights-split graph
 * (primitive #3) this settlement instruction was computed against.
 */
export function buildRoyaltySettlementEvent({ actor, subject, trigger, splitGraphRef, instructions, issuedAt = new Date().toISOString() }) {
  if (!trigger) throw new TypeError("trigger is required");
  if (!splitGraphRef) throw new TypeError("splitGraphRef is required");
  if (!Array.isArray(instructions) || instructions.length === 0) {
    throw new TypeError("instructions must be a non-empty array of {payee, amount, asset}");
  }
  return {
    eventType: EVENT_TYPES.ROYALTY_SETTLEMENT_INSTRUCTION,
    actor,
    subject,
    issuedAt,
    payload: { trigger, splitGraphRef, instructions },
  };
}
