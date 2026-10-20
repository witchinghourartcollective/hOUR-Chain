import test from "node:test";
import assert from "node:assert/strict";
import {
  CliqueClient,
  NotConfiguredError,
  EVENT_TYPES,
  SUPPORTED_CHAINS,
  buildClobFillEvent,
  buildLoyaltyRewardEvent,
  buildRoyaltySettlementEvent,
} from "../src/index.mjs";

const measurement = "a".repeat(64);

test("CliqueClient requires a pinned endpoint, attestation roots, and host allowlist", () => {
  assert.throws(() => new CliqueClient({ endpoint: undefined }), NotConfiguredError);
  assert.throws(() => new CliqueClient({
    endpoint: "https://clique.example",
    trustedEnclaves: [],
    trustedSigners: [measurement],
    allowedHosts: ["jsonplaceholder.typicode.com"],
  }), NotConfiguredError);
});

test("CliqueClient submits a read-only TLS query with pinned verifier roots", async () => {
  let clientConfig;
  let query;
  const client = new CliqueClient({
    endpoint: "https://clique.example/",
    trustedEnclaves: [measurement],
    trustedSigners: [measurement],
    allowedHosts: ["jsonplaceholder.typicode.com"],
    clientFactory: (config) => {
      clientConfig = config;
      return { runQuery: async (value) => {
        query = value;
        return {
          attestation: { id: "proof-1" },
          signature: "verified-signature",
          result: { response: "0x1234" },
        };
      } };
    },
  });
  const proof = await client.proveTlsSession({
    url: "https://jsonplaceholder.typicode.com/users",
    encoding: [{ from: "/0/id", soltype: "uint32" }],
  });

  assert.deepEqual(clientConfig.trustedEnclaves, [measurement]);
  assert.deepEqual(clientConfig.trustedSigners, [measurement]);
  assert.equal(clientConfig.allowExistQuery, false);
  assert.equal(query.method, "clique_httpsRequest");
  assert.equal(query.params.url, "https://jsonplaceholder.typicode.com/users");
  assert.equal(query.inputTypes.encoding, "Transformation[]");
  assert.deepEqual(proof.result, { response: "0x1234" });
  assert.equal(proof.verification, "clique-sdk-verified");
});

test("CliqueClient rejects unapproved hosts, credentials, and non-TLS endpoints", async () => {
  const client = new CliqueClient({
    endpoint: "https://clique.example",
    trustedEnclaves: [measurement],
    trustedSigners: [measurement],
    allowedHosts: ["jsonplaceholder.typicode.com"],
    clientFactory: () => ({ runQuery: async () => { throw new Error("must not query"); } }),
  });
  await assert.rejects(() => client.proveTlsSession({
    url: "https://other.example/data",
    encoding: [{ from: "/value", soltype: "string" }],
  }), /not allowlisted/);
  await assert.rejects(() => client.proveTlsSession({
    url: "https://user:password@jsonplaceholder.typicode.com/users",
    encoding: [{ from: "/0/id", soltype: "uint32" }],
  }), /credentials/);
  await assert.rejects(() => client.proveTlsSession({
    url: "http://jsonplaceholder.typicode.com/users",
    encoding: [{ from: "/0/id", soltype: "uint32" }],
  }), /must use HTTPS/);
  await assert.rejects(() => client.placeClobOrder({}), /not implemented/);
});

test("SUPPORTED_CHAINS matches ADR-0006 scope", () => {
  assert.deepEqual(SUPPORTED_CHAINS, ["solana", "evm-base", "hyperliquid"]);
});

test("buildClobFillEvent produces hour.clob-fill payload", () => {
  const event = buildClobFillEvent({
    actor: "identity:creator:test",
    subject: "work:test",
    fill: { orderId: "ord_1", price: "1.23", size: "10" },
  });
  assert.equal(event.eventType, EVENT_TYPES.CLOB_FILL);
  assert.equal(event.network, "hyperliquid");
  assert.throws(() => buildClobFillEvent({ fill: {} }), TypeError);
});

test("buildLoyaltyRewardEvent requires a positive reward", () => {
  assert.throws(
    () => buildLoyaltyRewardEvent({ signal: "stream-watch-time", rewardAmount: 0 }),
    TypeError,
  );
  const event = buildLoyaltyRewardEvent({
    actor: "identity:creator:test",
    subject: "fan:test",
    signal: "stream-watch-time",
    rewardAmount: 5,
  });
  assert.equal(event.eventType, EVENT_TYPES.LOYALTY_REWARD);
  assert.equal(event.payload.settlementAsset, "HOUR");
});

test("buildRoyaltySettlementEvent requires trigger, splitGraphRef, and instructions", () => {
  assert.throws(
    () => buildRoyaltySettlementEvent({ trigger: {}, splitGraphRef: "split:v1", instructions: [] }),
    TypeError,
  );
  const event = buildRoyaltySettlementEvent({
    actor: "identity:creator:test",
    subject: "work:test",
    trigger: { eventType: EVENT_TYPES.CLOB_FILL, eventId: "evt_1" },
    splitGraphRef: "split:v1",
    instructions: [{ payee: "identity:creator:a", amount: "5.00", asset: "USDC" }],
  });
  assert.equal(event.eventType, EVENT_TYPES.ROYALTY_SETTLEMENT_INSTRUCTION);
  assert.equal(event.payload.instructions.length, 1);
});
