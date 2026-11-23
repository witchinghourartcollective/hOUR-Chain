"""hOUR Chain settlement contract v2 for Google Cloud Universal Ledger.

Implements the atomic settle() from docs/ADR-0009-gcul-settlement-adapter.md:
one transaction both pays the payee and records the receipt. A GCUL method that
fails makes no state changes and moves no funds, so a replayed settlement_id
is rejected before any payment leaves the operator. This is payment-level
idempotency on the ledger itself, not just receipt deduplication (compare v1,
settlement_receipts.py).

The contract only moves the amount it is paid in the same call. It never holds
a balance between transactions, never approves time or rights, and stores only
opaque references (see ADR-0009 section 2).
"""

import gcul


class SettlementReceiptsV2(gcul.Contract):
    """Atomic pay-and-record settlement registry."""

    label: str
    receipt_count: int
    instruction_of: dict[str, str]
    contribution_ref_of: dict[str, str]
    agreement_ref_of: dict[str, str]
    payee_of: dict[str, str]
    amount_minor_of: dict[str, int]
    currency_of: dict[str, str]

    def __init__(self, label: str) -> None:
        self.label = label
        self.receipt_count = 0
        self.instruction_of = {}
        self.contribution_ref_of = {}
        self.agreement_ref_of = {}
        self.payee_of = {}
        self.amount_minor_of = {}
        self.currency_of = {}

    @gcul.payable
    def settle(
        self,
        settlement_id: str,
        instruction_id: str,
        contribution_ref: str,
        agreement_ref: str,
        payee: gcul.Account,
        amount_minor: int,
    ) -> int:
        """Pays the attached payment to payee and records the receipt atomically.

        amount_minor must equal the attached payment, so a misconfigured
        payment fails instead of settling the wrong amount. Returns the new
        receipt count.
        """
        assert self.is_owner(gcul.sender), "Only the settlement operator can settle"
        assert len(settlement_id) > 0, "settlement_id is required"
        assert len(instruction_id) > 0, "instruction_id is required"
        assert len(contribution_ref) > 0, "contribution_ref is required"
        assert len(agreement_ref) > 0, "agreement_ref is required"
        assert amount_minor > 0, "amount_minor must be positive"
        assert gcul.payment.value == amount_minor, "Payment does not match amount_minor"
        assert settlement_id not in self.instruction_of, "Duplicate settlement_id"

        self.instruction_of[settlement_id] = instruction_id
        self.contribution_ref_of[settlement_id] = contribution_ref
        self.agreement_ref_of[settlement_id] = agreement_ref
        self.payee_of[settlement_id] = payee.id
        self.amount_minor_of[settlement_id] = amount_minor
        self.currency_of[settlement_id] = gcul.payment.currency.code
        self.receipt_count += 1
        self.native_transfer(payee, gcul.payment)
        return self.receipt_count

    @gcul.readonly
    def is_recorded(self, settlement_id: str) -> bool:
        """Returns True if the settlement ID has already been settled."""
        return settlement_id in self.instruction_of
