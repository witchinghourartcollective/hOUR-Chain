"""Logic tests for settlement_receipts.py using a minimal stub of the gcul module.

Google's local GCUL simulator is not released yet, so this stub models only what
the contract uses: Contract.is_owner, Account, gcul.sender and @gcul.readonly.
Run from the repository root: python3 contracts/gcul/test_settlement_receipts.py -v
"""

import dataclasses
import pathlib
import sys
import types
import unittest

OWNER = "1:USR:DEM:owner"
OTHER = "1:USR:DEM:other"


@dataclasses.dataclass(frozen=True)
class Account:
    id: str


class Contract:
    _owner_id = OWNER

    def is_owner(self, account: Account) -> bool:
        return account.id == self._owner_id


gcul = types.ModuleType("gcul")
gcul.Account = Account
gcul.Contract = Contract
gcul.readonly = lambda fn: fn
gcul.sender = Account(OWNER)
sys.modules["gcul"] = gcul
sys.path.insert(0, str(pathlib.Path(__file__).parent))

from settlement_receipts import SettlementReceipts  # noqa: E402


def record(c, settlement_id="s-1", amount=100, ref="70fed00b"):
    return c.record_settlement(
        settlement_id, "contrib-1", "agree-1", Account(OTHER), amount, ref
    )


class SettlementReceiptsTest(unittest.TestCase):

    def setUp(self):
        gcul.sender = Account(OWNER)
        self.c = SettlementReceipts("hour-test")

    def test_records_receipt(self):
        self.assertEqual(record(self.c), 1)
        self.assertTrue(self.c.is_recorded("s-1"))
        self.assertEqual(self.c.contribution_of["s-1"], "contrib-1")
        self.assertEqual(self.c.agreement_of["s-1"], "agree-1")
        self.assertEqual(self.c.payee_of["s-1"], OTHER)
        self.assertEqual(self.c.amount_minor_of["s-1"], 100)
        self.assertEqual(self.c.payment_ref_of["s-1"], "70fed00b")

    def test_rejects_duplicate_settlement_id(self):
        record(self.c)
        with self.assertRaisesRegex(AssertionError, "Duplicate"):
            record(self.c)
        self.assertEqual(self.c.receipt_count, 1)

    def test_only_owner_can_record(self):
        gcul.sender = Account(OTHER)
        with self.assertRaisesRegex(AssertionError, "Only the owner"):
            record(self.c)
        self.assertFalse(self.c.is_recorded("s-1"))

    def test_rejects_non_positive_amount_and_missing_ids(self):
        with self.assertRaisesRegex(AssertionError, "positive"):
            record(self.c, amount=0)
        with self.assertRaisesRegex(AssertionError, "settlement_id"):
            record(self.c, settlement_id="")
        with self.assertRaisesRegex(AssertionError, "payment_ref"):
            record(self.c, ref="")
        self.assertEqual(self.c.receipt_count, 0)


if __name__ == "__main__":
    unittest.main()
