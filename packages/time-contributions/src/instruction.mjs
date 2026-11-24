// Builds a settlement instruction payload (specs/payloads/settlement-instruction.schema.json)
// from a calculated obligation, for the settlement adapter (e.g. gcul-adapter).
// The caller signs it as a settlement.instruction event with the operator key.
import { RegistryError } from './registry.mjs';

export function buildSettlementInstruction(registry, obligationEventId, { network, currency, payeeAccount }) {
  const obligation = registry.obligation(obligationEventId);
  if (!obligation) throw new RegistryError(`unknown obligation ${obligationEventId}`);
  if (!obligation.valid) throw new RegistryError('obligation is stale: its contribution or agreement version is no longer approved');
  const p = obligation.payload;
  if (currency && p.currency !== currency) throw new RegistryError(`obligation currency ${p.currency} is not ${currency}`);
  const account = payeeAccount(p.payee);
  if (!account) throw new RegistryError(`no ${network} account for payee ${p.payee}`);
  const [cId, cVer] = split(p.contributionRef);
  const [aId, aVer] = split(p.agreementRef);
  const approvals = [
    ...registry.approvalEventIds(cId, cVer, 'contribution'),
    ...registry.approvalEventIds(aId, aVer, 'agreement'),
  ];
  return {
    network,
    currency: p.currency,
    contributionRef: p.contributionRef,
    agreementRef: p.agreementRef,
    obligationRef: obligationEventId,
    legs: [{ legIndex: 0, payee: account, amountMinor: p.amountMinor }],
    approvals,
  };
}

function split(ref) {
  const at = ref.lastIndexOf('@');
  return [ref.slice(0, at), Number(ref.slice(at + 1))];
}
