"""Logic tests for settlement_receipts_v2.py using a minimal stub of the gcul module.

Google's local GCUL simulator is not released yet. This stub models what v2
uses (Contract.is_owner, native_transfer, Account, Amount, Currency, sender,
payment, @payable, @readonly) and the ledger's all-or-nothing execution: a
failed call leaves contract state and transfers exactly as they were.
Run from the repository root: python3 contracts/gcul/test_settlement_receipts_v2.py -v
"""

import copy
import dataclasses
import pathlib
import sys
import types
import unittest

OWNER = "1:USR:DEM:owner"
OTHER = "1:USR:DEM:other"
PAYEE = "1:USR:DEM:payee"


@dataclasses.dataclass(frozen=True)
class Account:
    id: str


@dataclasses.dataclass(frozen=True)
class Currency:
    code: str
    operator_id: str


@dataclasses.dataclass(frozen=True)
class Amount:
    value: int
    currency: Currency


DEM = Currency("DEM", "1:TKN:DEM:operator")


class Contract:
    _owner_id = OWNER

    def __init__(self):
        self.transfers = []

    def is_owner(self, account: Account) -> bool:
        return account.id == self._owner_id

    def native_transfer(self, beneficiary: Account, amount: Amount) -> None:
        self.transfers.append((beneficiary.id, amount.value, amount.currency.code))


gcul = types.ModuleType("gcul")
gcul.Account = Account
gcul.Amount = Amount
gcul.Currency = Currency
gcul.Contract = Contract
gcul.payable = lambda fn: fn
gcul.readonly = lambda fn: fn
sys.modules["gcul"] = gcul
sys.path.insert(0, str(pathlib.Path(__file__).parent))

from settlement_receipts_v2 import SettlementReceiptsV2  # noqa: E402


def make_contract():
    c = SettlementReceiptsV2.__new__(SettlementReceiptsV2)
    Contract.__init__(c)
    SettlementReceiptsV2.__init__(c, "hour-test-v2")
    return c


def invoke(c, sender, payment_value, settlement_id="hst1_a", amount_minor=None):
    """Runs settle() with ledger semantics: on failure, roll back everything."""
    gcul.sender = Account(sender)
    gcul.payment = Amount(payment_value, DEM)
    snapshot = copy.deepcopy(c.__dict__)
    try:
        return c.settle(
            settlement_id,
            "evt-instruction-1",
            "contrib-1@3",
            "agree-1@2",
            Account(PAYEE),
            payment_value if amount_minor is None else amount_minor,
        )
    except AssertionError:
        c.__dict__.clear()
        c.__dict__.update(snapshot)
        raise


class SettlementReceiptsV2Test(unittest.TestCase):

    def setUp(self):
        self.c = make_contract()

    def test_settle_pays_and_records_atomically(self):
        self.assertEqual(invoke(self.c, OWNER, 100), 1)
        self.assertEqual(self.c.transfers, [(PAYEE, 100, "DEM")])
        self.assertTrue(self.c.is_recorded("hst1_a"))
        self.assertEqual(self.c.instruction_of["hst1_a"], "evt-instruction-1")
        self.assertEqual(self.c.contribution_ref_of["hst1_a"], "contrib-1@3")
        self.assertEqual(self.c.agreement_ref_of["hst1_a"], "agree-1@2")
        self.assertEqual(self.c.payee_of["hst1_a"], PAYEE)
        self.assertEqual(self.c.amount_minor_of["hst1_a"], 100)
        self.assertEqual(self.c.currency_of["hst1_a"], "DEM")

    def test_duplicate_settlement_moves_no_funds(self):
        invoke(self.c, OWNER, 100)
        with self.assertRaisesRegex(AssertionError, "Duplicate"):
            invoke(self.c, OWNER, 100)
        self.assertEqual(self.c.transfers, [(PAYEE, 100, "DEM")])
        self.assertEqual(self.c.receipt_count, 1)

    def test_non_owner_cannot_settle(self):
        with self.assertRaisesRegex(AssertionError, "settlement operator"):
            invoke(self.c, OTHER, 100)
        self.assertEqual(self.c.transfers, [])
        self.assertFalse(self.c.is_recorded("hst1_a"))

    def test_payment_must_match_amount(self):
        with self.assertRaisesRegex(AssertionError, "does not match"):
            invoke(self.c, OWNER, 100, amount_minor=150)
        self.assertEqual(self.c.transfers, [])
        self.assertEqual(self.c.receipt_count, 0)

    def test_rejects_missing_ids_and_non_positive_amount(self):
        with self.assertRaisesRegex(AssertionError, "settlement_id is required"):
            invoke(self.c, OWNER, 100, settlement_id="")
        with self.assertRaisesRegex(AssertionError, "positive"):
            invoke(self.c, OWNER, 0)
        self.assertEqual(self.c.transfers, [])

    def test_distinct_settlements_each_pay_once(self):
        invoke(self.c, OWNER, 100, settlement_id="hst1_a")
        invoke(self.c, OWNER, 250, settlement_id="hst1_b")
        self.assertEqual(self.c.transfers, [(PAYEE, 100, "DEM"), (PAYEE, 250, "DEM")])
        self.assertEqual(self.c.receipt_count, 2)


if __name__ == "__main__":
    unittest.main()
