// UlCliLedger output parsing and argument building, using outputs captured from
// the contract v2 runs on GCUL integration-testing (2026-11-23). No network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UlCliLedger, parseSettleResult, parseContractReceipts,
  DuplicateSettlementError, LedgerRejectedError, OutcomeUnknownError,
} from '../src/index.mjs';

const SUCCESS = `Successfully invoked settle on contract hour_settlement_v2 in transaction 7f00df8f864f7d30c2cd16a345c352d0aebe9eb9b83ba66d8d2f7809bf778730
Transaction succeeded.
Round ID: 5050653
Events:
  transaction_output:
    result: 1
2026/11/23 07:20:11 Successfully wrote config file: "/home/.config/ul-cli/config.yaml"`;

const DUPLICATE = `Error: transaction did not successfully complete: transaction attempt failed with FAILED_PRECONDITION: Duplicate settlement_id
Usage:
  ul-cli contracts invoke [flags]
transaction did not successfully complete: transaction attempt failed with FAILED_PRECONDITION: Duplicate settlement_id`;

const MISMATCH = 'Error: transaction did not successfully complete: transaction attempt failed with FAILED_PRECONDITION: Payment does not match amount_minor';

const UNAVAILABLE = 'Error: failed endpoint connection check: rpc error: code = Unavailable desc =';

const DESCRIBE = `Account: 1:CTR:005788bGkaVpczkhPsWCfVfToTxywz15AiZG5fVD1f769
Contract account details:
  Owner: 1:USR:DEM:0256bBuqu4nuCNRud1CMwF5FFtm4LdRyD8X8UCYNgyGa9
  Contract fields:
    agreement_ref_of: {"hst1_test_0001": "agree-test-0001@1"}
    amount_minor_of: {"hst1_test_0001": 100}
    contribution_ref_of: {"hst1_test_0001": "contrib-test-0001@1"}
    currency_of: {"hst1_test_0001": "DEM"}
    instruction_of: {"hst1_test_0001": "evt-test-instruction-0001"}
    label: "hour-settlement-v2-test"
    payee_of: {"hst1_test_0001": "1:USR:DEM:022nXHgAmjMB8mXkdDcqA3HaR9D8EyXD6vAj6urJ7qJ68"}
    receipt_count: 1

  Balances:
    None`;

test('parses a successful settle into tx hash and round', () => {
  assert.deepEqual(parseSettleResult(0, SUCCESS), {
    txRef: '7f00df8f864f7d30c2cd16a345c352d0aebe9eb9b83ba66d8d2f7809bf778730',
    round: 5050653,
  });
});

test('classifies failures by what is known about the outcome', () => {
  assert.throws(() => parseSettleResult(1, DUPLICATE), DuplicateSettlementError);
  assert.throws(() => parseSettleResult(1, MISMATCH), (e) => e instanceof LedgerRejectedError && /does not match/.test(e.message));
  assert.throws(() => parseSettleResult(1, UNAVAILABLE), OutcomeUnknownError);
  assert.throws(() => parseSettleResult(0, 'something unexpected'), OutcomeUnknownError);
});

test('parses contract v2 receipts from describe output', () => {
  assert.deepEqual(parseContractReceipts(DESCRIBE), [{
    settlementId: 'hst1_test_0001',
    instructionId: 'evt-test-instruction-0001',
    contributionRef: 'contrib-test-0001@1',
    agreementRef: 'agree-test-0001@1',
    payee: '1:USR:DEM:022nXHgAmjMB8mXkdDcqA3HaR9D8EyXD6vAj6urJ7qJ68',
    amountMinor: 100,
    currency: 'DEM',
  }]);
  assert.deepEqual(parseContractReceipts(DESCRIBE.replace(/\{"hst1[^\n]*\}/g, '{}')), []);
});

test('builds the settle invocation with payee alias and payment', async () => {
  let seen;
  const ledger = new UlCliLedger({
    bin: '/fake/ul-cli',
    querySender: 'hour_chain_owner',
    payeeAliases: { '1:USR:DEM:payee': 'hour_chain_user2' },
    run: async (bin, args) => { seen = { bin, args }; return { code: 0, output: SUCCESS }; },
  });
  const result = await ledger.settle({ contractAlias: 'hour_settlement_v2', sender: 'hour_chain_owner', paymentMinor: 100,
    settlementId: 'hst1_' + 'a'.repeat(40), instructionId: 'evt-instruction-0001', contributionRef: 'contrib-1@3',
    agreementRef: 'agree-1@2', payee: '1:USR:DEM:payee', amountMinor: 100 });
  assert.equal(result.round, 5050653);
  assert.equal(seen.bin, '/fake/ul-cli');
  const joined = seen.args.join(' ');
  assert.match(joined, /contracts invoke --alias hour_settlement_v2 --method-name settle --sender hour_chain_owner --payment 100/);
  assert.match(joined, /--arg payee=Account\(hour_chain_user2\)/);
  assert.match(joined, /--arg settlement_id="hst1_a{40}"/);
  assert.match(joined, /--arg amount_minor=100/);
});

test('read queries are signed by the operator, and querySender is required', async () => {
  let seen;
  const ledger = new UlCliLedger({ querySender: 'hour_chain_owner', run: async (bin, args) => { seen = args; return { code: 0, output: DESCRIBE }; } });
  assert.equal((await ledger.getReceipt('hour_settlement_v2', 'hst1_test_0001')).amountMinor, 100);
  assert.match(seen.join(' '), /accounts describe --alias hour_settlement_v2 --sender hour_chain_owner/);
  assert.throws(() => new UlCliLedger({}), /querySender/);
});

test('payee alias must describe exactly the approved account', async () => {
  let output = 'Account: 1:USR:DEM:payee\n';
  let code = 0;
  let seen;
  const ledger = new UlCliLedger({ querySender: 'op', payeeAliases: { '1:USR:DEM:payee': 'user2' },
    run: async (_bin, args) => { seen = args; return { code, output }; } });
  await ledger.verifyPayee('1:USR:DEM:payee');
  assert.match(seen.join(' '), /accounts describe --alias user2 --sender op/);
  output = 'Account: 1:USR:DEM:someone-else\n';
  await assert.rejects(ledger.verifyPayee('1:USR:DEM:payee'), /does not resolve/);
  output = 'Account: 1:USR:DEM:payee\nAccount: 1:USR:DEM:someone-else\n';
  await assert.rejects(ledger.verifyPayee('1:USR:DEM:payee'), /does not resolve/);
  output = 'unrecognised output';
  await assert.rejects(ledger.verifyPayee('1:USR:DEM:payee'), /does not resolve/);
  code = 1;
  await assert.rejects(ledger.verifyPayee('1:USR:DEM:payee'), /describe payee .* failed/);
  await assert.rejects(ledger.verifyPayee('missing'), /invalid local/);
});

test('refuses unknown payees and unsafe argument values before calling ul-cli', async () => {
  let called = false;
  const ledger = new UlCliLedger({ querySender: 'op', payeeAliases: { p: 'alias' }, run: async () => { called = true; return { code: 0, output: SUCCESS }; } });
  const base = { contractAlias: 'c', sender: 's', paymentMinor: 1, settlementId: 'hst1_x', instructionId: 'i',
    contributionRef: 'c@1', agreementRef: 'a@1', amountMinor: 1 };
  await assert.rejects(ledger.settle({ ...base, payee: 'unknown' }), LedgerRejectedError);
  await assert.rejects(ledger.settle({ ...base, payee: 'p', contributionRef: 'x"; drop' }), /unsafe/);
  ledger.payeeAliases.p = 'alias);malicious(';
  await assert.rejects(ledger.verifyPayee('p'), /invalid local/);
  await assert.rejects(ledger.settle({ ...base, payee: 'p' }), /unsafe/);
  assert.equal(called, false);
});
