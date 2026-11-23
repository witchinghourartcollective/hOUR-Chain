"""hOUR Chain settlement-receipt registry for Google Cloud Universal Ledger.

Test contract for the GCUL settlement adapter (see docs/GCUL-INTEGRATION-TESTING.md
and docs/TIME-CONTRIBUTIONS.md). It records that a settlement happened and
links it to an approved contribution and agreement. It does not move funds,
approve time, or decide rights: those stay in their own systems.

Guarantees:
- Only the contract owner (the hOUR settlement operator) can record receipts.
- A settlement ID can be recorded once (receipt deduplication only; payment-level
  idempotency is the settlement adapter's responsibility).
- Every receipt carries the contribution ID, agreement ID, payee, amount in
  minor units, and an external payment reference for reconciliation.
"""

import gcul


class SettlementReceipts(gcul.Contract):
    """Append-only registry of hOUR settlement receipts."""

    label: str
    receipt_count: int
    contribution_of: dict[str, str]
    agreement_of: dict[str, str]
    payee_of: dict[str, str]
    amount_minor_of: dict[str, int]
    payment_ref_of: dict[str, str]

    def __init__(self, label: str) -> None:
        self.label = label
        self.receipt_count = 0
        self.contribution_of = {}
        self.agreement_of = {}
        self.payee_of = {}
        self.amount_minor_of = {}
        self.payment_ref_of = {}

    def record_settlement(
        self,
        settlement_id: str,
        contribution_id: str,
        agreement_id: str,
        payee: gcul.Account,
        amount_minor: int,
        payment_ref: str,
    ) -> int:
        """Records one settlement receipt; returns the new receipt count."""
        assert self.is_owner(gcul.sender), "Only the owner can record settlements"
        assert len(settlement_id) > 0, "settlement_id is required"
        assert len(contribution_id) > 0, "contribution_id is required"
        assert len(agreement_id) > 0, "agreement_id is required"
        assert len(payment_ref) > 0, "payment_ref is required"
        assert amount_minor > 0, "amount_minor must be positive"
        assert settlement_id not in self.contribution_of, "Duplicate settlement_id"

        self.contribution_of[settlement_id] = contribution_id
        self.agreement_of[settlement_id] = agreement_id
        self.payee_of[settlement_id] = payee.id
        self.amount_minor_of[settlement_id] = amount_minor
        self.payment_ref_of[settlement_id] = payment_ref
        self.receipt_count += 1
        return self.receipt_count

    @gcul.readonly
    def is_recorded(self, settlement_id: str) -> bool:
        """Returns True if the settlement ID has already been recorded."""
        return settlement_id in self.contribution_of
