// Validates the settlement payload schemas, the envelope's gcul network value,
// and the ADR-0009 settlement ID rule against fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { deriveSettlementId, SETTLEMENT_ID_PATTERN } from '../packages/gcul-adapter/src/settlement-id.mjs';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateInstruction = ajv.compile(load('specs/payloads/settlement-instruction.schema.json'));
const validateReceipt = ajv.compile(load('specs/payloads/settlement-receipt.schema.json'));
const validateEnvelope = ajv.compile(load('specs/event-envelope.schema.json'));
const instruction = load('specs/fixtures/settlement/gcul-instruction.json');
const receipt = load('specs/fixtures/settlement/gcul-receipt.json');

test('gcul instruction and receipt fixtures validate', () => {
  assert.ok(validateInstruction(instruction), JSON.stringify(validateInstruction.errors));
  assert.ok(validateReceipt(receipt), JSON.stringify(validateReceipt.errors));
});

test('receipt settlementId follows the ADR-0009 derivation', () => {
  assert.equal(receipt.settlementId, deriveSettlementId(receipt.instructionEventId, receipt.legIndex));
  assert.match(receipt.settlementId, SETTLEMENT_ID_PATTERN);
});

test('settlement ID is deterministic and distinct per leg', () => {
  const id = 'evt-test-instruction-0001';
  assert.equal(deriveSettlementId(id, 0), deriveSettlementId(id, 0));
  assert.notEqual(deriveSettlementId(id, 0), deriveSettlementId(id, 1));
  assert.throws(() => deriveSettlementId('short', 0), TypeError);
  assert.throws(() => deriveSettlementId(id, -1), TypeError);
  assert.throws(() => deriveSettlementId(id, 1.5), TypeError);
});

test('envelope accepts network "gcul" and still rejects unknown networks', () => {
  const envelope = {
    eventId: 'evt-test-instruction-0001',
    protocolVersion: '0.2',
    schemaVersion: '1',
    eventType: 'settlement.instruction',
    actor: 'hour:operator',
    subject: 'contrib-test-0001',
    issuedAt: '2026-11-23T07:20:00Z',
    payloadHash: 'a'.repeat(64),
    network: 'gcul',
    signature: { algorithm: 'ML-DSA-65', suiteVersion: '1', signer: 'hour:operator#k1', value: 'sig' },
  };
  assert.ok(validateEnvelope(envelope), JSON.stringify(validateEnvelope.errors));
  assert.ok(!validateEnvelope({ ...envelope, network: 'gcul-mainnet' }));
});

test('instruction rejects float amounts, unversioned refs and empty legs', () => {
  const bad = (patch) => !validateInstruction({ ...instruction, ...patch });
  assert.ok(bad({ legs: [{ legIndex: 0, payee: 'p', amountMinor: 1.5 }] }), 'float amount');
  assert.ok(bad({ legs: [{ legIndex: 0, payee: 'p', amountMinor: 0 }] }), 'zero amount');
  assert.ok(bad({ contributionRef: 'contrib-test-0001' }), 'unversioned contribution');
  assert.ok(bad({ legs: [] }), 'no legs');
  assert.ok(bad({ approvals: [] }), 'no approvals');
});

test('receipt rejects malformed settlement IDs and unknown finality', () => {
  assert.ok(!validateReceipt({ ...receipt, settlementId: 'hst1_test_0001' }));
  assert.ok(!validateReceipt({ ...receipt, finality: 'pending' }));
});
