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

test("CliqueClient throws NotConfiguredError without credentials", async () => {
  const client = new CliqueClient({ apiKey: undefined, walletId: undefined });
  await assert.rejects(() => client.placeClobOrder({}), NotConfiguredError);
  await assert.rejects(() => client.getBalances("solana"), NotConfiguredError);
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
