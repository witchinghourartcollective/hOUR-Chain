// Ledger clients for the GCUL settlement adapter.
//
// Both clients expose the same interface:
//   settle(call)                 -> { txRef, round }   or throws a LedgerError subclass
//   getReceipt(alias, id)        -> receipt | null      (read-only)
//   listReceipts(alias)          -> receipt[]           (read-only)
//
// Error classes tell the adapter what is known about the outcome, which is all
// that matters for idempotency (ADR-0009 section 3):
//   DuplicateSettlementError  the ledger says this settlement ID is already settled; nothing moved now
//   LedgerRejectedError       the ledger rejected the call; nothing moved
//   OutcomeUnknownError       timeout, crash or transport failure; the call may or may not have committed
import { execFile } from 'node:child_process';

export class LedgerError extends Error {}
export class DuplicateSettlementError extends LedgerError {}
export class LedgerRejectedError extends LedgerError {}
export class OutcomeUnknownError extends LedgerError {}

// In-memory ledger with contract v2 semantics: settle() checks everything, then
// records the receipt and moves funds in one step, or fails with no change.
// `faults` injects failures for tests:
//   'timeout-before-commit'  throws OutcomeUnknownError, nothing committed
//   'timeout-after-commit'   commits, then throws OutcomeUnknownError (the dangerous case)
export class FakeLedger {
  constructor({ operator, balances = {}, currency = 'DEM' } = {}) {
    this.operator = operator;
    this.balances = { ...balances };
    this.currency = currency;
    this.contracts = new Map();
    this.faults = [];
    this.round = 1000;
    this.txCount = 0;
    this.settleCalls = 0;
  }

  deploy(alias) {
    this.contracts.set(alias, new Map());
  }

  // Simulates a receipt written outside the adapter, for orphan detection tests.
  injectReceipt(alias, receipt) {
    this.contracts.get(alias).set(receipt.settlementId, receipt);
  }

  async settle(call) {
    this.settleCalls += 1;
    const fault = this.faults.shift();
    if (fault === 'timeout-before-commit') throw new OutcomeUnknownError('deadline exceeded');
    const receipts = this.contracts.get(call.contractAlias);
    if (!receipts) throw new LedgerRejectedError(`no contract ${call.contractAlias}`);
    if (call.sender !== this.operator) throw new LedgerRejectedError('Only the settlement operator can settle');
    if (call.paymentMinor !== call.amountMinor) throw new LedgerRejectedError('Payment does not match amount_minor');
    if (receipts.has(call.settlementId)) throw new DuplicateSettlementError('Duplicate settlement_id');
    if ((this.balances[call.sender] ?? 0) < call.paymentMinor) throw new LedgerRejectedError('insufficient balance');

    this.round += 1;
    this.txCount += 1;
    const txRef = `faketx${String(this.txCount).padStart(58, '0')}`;
    this.balances[call.sender] -= call.paymentMinor;
    this.balances[call.payee] = (this.balances[call.payee] ?? 0) + call.paymentMinor;
    receipts.set(call.settlementId, {
      settlementId: call.settlementId,
      instructionId: call.instructionId,
      contributionRef: call.contributionRef,
      agreementRef: call.agreementRef,
      payee: call.payee,
      amountMinor: call.amountMinor,
      currency: this.currency,
    });
    if (fault === 'timeout-after-commit') throw new OutcomeUnknownError('deadline exceeded after send');
    return { txRef, round: this.round };
  }

  async getReceipt(alias, settlementId) {
    return this.contracts.get(alias)?.get(settlementId) ?? null;
  }

  async listReceipts(alias) {
    return [...(this.contracts.get(alias)?.values() ?? [])];
  }
}

// Real client: drives contract v2 through the ul-cli wrapper (scripts/gcul/ul-cli.wrapper),
// which signs with the sender's Cloud KMS key. Only settle() submits a transaction.
//
// `payeeAliases` maps payee account IDs to local ul-cli aliases, because ul-cli's
// Account(...) argument takes an alias. Every payee must be registered locally first.
export class UlCliLedger {
  constructor({ bin = `${process.env.HOME}/bin/ul-cli`, timeout = '90s', payeeAliases = {}, querySender, run = runCommand } = {}) {
    if (!querySender) throw new TypeError('querySender (the operator alias used to sign read queries) is required');
    this.querySender = querySender;
    this.bin = bin;
    this.timeout = timeout;
    this.payeeAliases = payeeAliases;
    this.run = run;
  }

  async settle(call) {
    const payeeAlias = this.payeeAliases[call.payee];
    if (!payeeAlias) throw new LedgerRejectedError(`no local ul-cli alias for payee ${call.payee}`);
    if (!/^[A-Za-z0-9_-]+$/.test(payeeAlias)) throw new LedgerRejectedError(`unsafe payee alias: ${payeeAlias}`);
    const args = ['--timeout', this.timeout, 'contracts', 'invoke', '--alias', call.contractAlias,
      '--method-name', 'settle', '--sender', call.sender, '--payment', String(call.paymentMinor),
      '--arg', `settlement_id=${pyStr(call.settlementId)}`,
      '--arg', `instruction_id=${pyStr(call.instructionId)}`,
      '--arg', `contribution_ref=${pyStr(call.contributionRef)}`,
      '--arg', `agreement_ref=${pyStr(call.agreementRef)}`,
      '--arg', `payee=Account(${payeeAlias})`,
      '--arg', `amount_minor=${call.amountMinor}`];
    const { code, output } = await this.run(this.bin, args);
    return parseSettleResult(code, output);
  }

  async verifyPayee(payee) {
    const alias = this.payeeAliases[payee];
    if (!alias || !/^[A-Za-z0-9_-]+$/.test(alias)) throw new LedgerRejectedError(`invalid local ul-cli alias for payee ${payee}`);
    const { code, output } = await this.run(this.bin,
      ['--timeout', this.timeout, 'accounts', 'describe', '--alias', alias, '--sender', this.querySender]);
    if (code !== 0) throw new LedgerRejectedError(`describe payee ${alias} failed: ${lastLine(output)}`);
    const accounts = [...output.matchAll(/^\s*Account:\s*(\S+)\s*$/gm)];
    if (accounts.length !== 1 || accounts[0][1] !== payee) {
      throw new LedgerRejectedError(`payee alias ${alias} does not resolve to ${payee}`);
    }
  }

  async getReceipt(alias, settlementId) {
    return (await this.listReceipts(alias)).find((r) => r.settlementId === settlementId) ?? null;
  }

  async listReceipts(alias) {
    const { code, output } = await this.run(this.bin,
      ['--timeout', this.timeout, 'accounts', 'describe', '--alias', alias, '--sender', this.querySender]);
    if (code !== 0) throw new OutcomeUnknownError(`describe ${alias} failed: ${lastLine(output)}`);
    return parseContractReceipts(output);
  }
}

export function parseSettleResult(code, output) {
  if (code === 0) {
    const tx = output.match(/in transaction ([0-9a-f]{64})/);
    const round = output.match(/Round ID:\s*(\d+)/);
    if (!tx || !/Transaction succeeded/.test(output)) {
      throw new OutcomeUnknownError(`unrecognised success output: ${lastLine(output)}`);
    }
    return { txRef: tx[1], round: round ? Number(round[1]) : null };
  }
  if (/FAILED_PRECONDITION: Duplicate settlement_id/.test(output)) {
    throw new DuplicateSettlementError('Duplicate settlement_id');
  }
  const precondition = output.match(/FAILED_PRECONDITION: ([^\n]+)/);
  if (precondition) throw new LedgerRejectedError(precondition[1].trim());
  // Anything else (deadline exceeded, Unavailable after submission, a crashed
  // container) is treated as unknown: the transaction may have committed.
  throw new OutcomeUnknownError(lastLine(output) || `ul-cli exited ${code}`);
}

// Parses contract v2 fields from `accounts describe` output. Each map field is
// printed as JSON, for example:  payee_of: {"hst1_...": "1:USR:..."}
export function parseContractReceipts(output) {
  const field = (name) => {
    const m = output.match(new RegExp(`^\\s*${name}: (\\{.*\\})\\s*$`, 'm'));
    return m ? JSON.parse(m[1]) : {};
  };
  const instruction = field('instruction_of');
  const contribution = field('contribution_ref_of');
  const agreement = field('agreement_ref_of');
  const payee = field('payee_of');
  const amount = field('amount_minor_of');
  const currency = field('currency_of');
  return Object.keys(instruction).map((settlementId) => ({
    settlementId,
    instructionId: instruction[settlementId],
    contributionRef: contribution[settlementId],
    agreementRef: agreement[settlementId],
    payee: payee[settlementId],
    amountMinor: amount[settlementId],
    currency: currency[settlementId],
  }));
}

function pyStr(value) {
  if (!/^[A-Za-z0-9_.:@\-]+$/.test(value)) throw new LedgerRejectedError(`unsafe argument value: ${value}`);
  return `"${value}"`;
}

function lastLine(output) {
  return output.trim().split('\n').filter((l) => !/wrote config file/.test(l)).pop() ?? '';
}

function runCommand(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd: process.env.HOME, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? 1) : 0, output: `${stdout}${stderr}` });
    });
  });
}
