import { randomInt } from "node:crypto";
import { Client as CliqueSdkClient } from "@cliqueofficial/clique-client-sdk-node";

// Clique TEE Network adapter — see docs/ADR-0006-clique-tee-oracle-clob-loyalty.md
//
// The TLS Oracle is read-only. The build*Event helpers produce hOUR Chain
// event payloads (not yet signed — pass the result to signEnvelope from
// @hour-chain/pqc-profile).

export const EVENT_TYPES = Object.freeze({
  CLOB_FILL: "hour.clob-fill",
  LOYALTY_REWARD: "hour.loyalty-reward",
  ROYALTY_SETTLEMENT_INSTRUCTION: "hour.royalty-settlement-instruction",
});

export const SUPPORTED_CHAINS = Object.freeze(["solana", "evm-base", "hyperliquid"]);

const parseCsv = (value) => value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];

function requireMeasurements(name, values) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !/^[a-f0-9]{64}$/i.test(value))) {
    throw new NotConfiguredError(`${name} must be a comma-separated allowlist of 64-character hex measurements`);
  }
  return values.map((value) => value.toLowerCase());
}

function validateRequest({ url, encoding, allowedHosts }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError("url must be a valid HTTPS URL");
  }
  const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new TypeError("TLS Oracle requests must use HTTPS (HTTP is allowed only for a loopback test endpoint)");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new TypeError("url must not contain credentials or a fragment");
  }
  if (!allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new TypeError(`TLS Oracle host is not allowlisted: ${parsed.hostname}`);
  }
  if (!Array.isArray(encoding) || encoding.length === 0 || encoding.some(
    (item) => !item || typeof item.from !== "string" || typeof item.soltype !== "string" || !item.soltype.trim(),
  )) {
    throw new TypeError("encoding must be a non-empty array of { from, soltype }");
  }
  return { url: parsed.toString(), encoding };
}

/** Read-only Clique TLS Oracle client. Clique's SDK verifies the returned proof. */
export class CliqueClient {
  constructor({
    endpoint = process.env.CLIQUE_ENDPOINT,
    trustedEnclaves = parseCsv(process.env.CLIQUE_TRUSTED_ENCLAVES),
    trustedSigners = parseCsv(process.env.CLIQUE_TRUSTED_SIGNERS),
    allowedHosts = parseCsv(process.env.CLIQUE_TLS_ALLOWED_HOSTS),
    clientFactory = (config) => new CliqueSdkClient(config),
  } = {}) {
    if (!endpoint) throw new NotConfiguredError("Set CLIQUE_ENDPOINT to the Clique Network endpoint");
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(endpointUrl.hostname)) {
      throw new NotConfiguredError("CLIQUE_ENDPOINT must use HTTPS (HTTP is allowed only for a loopback endpoint)");
    }
    this.allowedHosts = allowedHosts.map((host) => host.toLowerCase());
    if (this.allowedHosts.length === 0) throw new NotConfiguredError("Set CLIQUE_TLS_ALLOWED_HOSTS to an exact host allowlist");
    this.client = clientFactory({
      endpoint: endpointUrl.toString().replace(/\/$/, ""),
      pollingInterval: 500,
      retryNumber: 5,
      timeout: 60_000,
      allowExistQuery: false,
      trustedEnclaves: requireMeasurements("CLIQUE_TRUSTED_ENCLAVES", trustedEnclaves),
      trustedSigners: requireMeasurements("CLIQUE_TRUSTED_SIGNERS", trustedSigners),
    });
  }

  /** Query a read-only HTTPS JSON endpoint and return the SDK-verified proof. */
  async proveTlsSession({ url, encoding }) {
    const request = validateRequest({ url, encoding, allowedHosts: this.allowedHosts });
    const response = await this.client.runQuery({
      id: randomInt(1, 2 ** 31),
      method: "clique_httpsRequest",
      params: request,
      inputTypes: { url: "string", encoding: "Transformation[]" },
      customTypes: { Transformation: { from: "string", soltype: "string" } },
    });
    if (!response?.attestation || !response?.signature || !response?.result) {
      throw new Error("Clique SDK returned an incomplete verified response");
    }
    return {
      verification: "clique-sdk-verified",
      request,
      result: response.result,
      attestation: response.attestation,
      signature: response.signature,
    };
  }

  async placeClobOrder() {
    throw new Error("Clique Wallet trading is not implemented by this read-only adapter");
  }

  async cancelClobOrder() {
    throw new Error("Clique Wallet trading is not implemented by this read-only adapter");
  }

  async getBalances() {
    throw new Error("Clique Wallet access is not implemented by this read-only adapter");
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
