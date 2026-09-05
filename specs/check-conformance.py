#!/usr/bin/env python3
"""Assert that specs/event-envelope.schema.json still encodes what SPEC.md requires.

This file exists because the two drifted. SPEC.md moved to Draft 0.2 and began
requiring a signature-suite version; the schema was not updated, so a document
that mandated downgrade resistance shipped alongside a schema with no version
field to compare. Nothing caught it.

Each check names the SPEC.md sentence it enforces. Run it after touching either
file. No dependencies beyond the standard library, by design: this repository
has no build, and a check that needs installing is a check that stops running.

    python3 specs/check-conformance.py
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "specs" / "event-envelope.schema.json"
SPEC_PATH = ROOT / "SPEC.md"

failures = []
checks = 0


def check(name, condition, detail=""):
    global checks
    checks += 1
    if not condition:
        failures.append(f"{name}\n      {detail}" if detail else name)


# Both reads and all output are explicitly ASCII-safe. These files are UTF-8,
# but a checkout can be read under a locale whose preferred encoding is not
# (LC_ALL=C gives ANSI_X3.4-1968), and the failure modes are asymmetric: an
# implicit read breaks the moment SPEC.md gains an em dash, and a non-ASCII
# glyph in the output crashes the script precisely when a check has failed.
schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
spec = SPEC_PATH.read_text(encoding="utf-8")
sig = schema["properties"]["signature"]
sig_props = sig["properties"]
sig_required = set(sig["required"])


# --- SPEC.md: "signature algorithm identifier, signature-suite version, and
# --- verification material."
check(
    "SPEC requires a signature-suite version, so SPEC.md must still say so",
    re.search(r"signature-suite version", spec) is not None,
    "If this requirement was deliberately dropped, delete the checks below too.",
)
for field, label in [
    ("algorithm", "algorithm identifier"),
    ("suiteVersion", "signature-suite version"),
    ("signer", "verification material"),
    ("value", "the signature itself"),
]:
    check(
        f"signature.{field} exists ({label})",
        field in sig_props,
        f"SPEC.md requires it; schema has {sorted(sig_props)}",
    )
    check(
        f"signature.{field} is required, not optional",
        field in sig_required,
        f"required is {sorted(sig_required)}",
    )


# --- SPEC.md: "Signature suites and address formats MUST be versioned,
# --- replaceable, and downgrade-resistant."
# Downgrade resistance means a validator must be able to order two versions and
# reject the older. Free-form strings are not orderable, so the version must be
# constrained to something that is.
check(
    "signature.suiteVersion is constrained to an orderable form",
    "pattern" in sig_props.get("suiteVersion", {}),
    "Downgrade resistance requires comparing versions; free-form strings cannot be compared.",
)
if "pattern" in sig_props.get("suiteVersion", {}):
    pattern = re.compile(sig_props["suiteVersion"]["pattern"])
    for good in ["1", "1.0", "2.11.3"]:
        check(f"suiteVersion accepts {good!r}", pattern.fullmatch(good) is not None)
    for bad in ["", "v1", "latest", "1.0-rc1", "one"]:
        check(
            f"suiteVersion rejects {bad!r}",
            pattern.fullmatch(bad) is None,
            "An unorderable version defeats downgrade comparison.",
        )


# --- A signature field that accepts an empty string is not verification
# --- material. Every part of the signature must carry content.
for field in ["algorithm", "signer", "value"]:
    check(
        f"signature.{field} rejects the empty string",
        sig_props.get(field, {}).get("minLength", 0) >= 1,
        "Without minLength, a signature of \"\" satisfies the schema.",
    )


# --- SPEC.md: "Implementations MUST use reviewed standards"; ADR-0002 requires
# --- algorithms to stay replaceable through governance. A hard enum in the
# --- schema would make every algorithm change a schema break, so the accepted
# --- set belongs in the suite registry. Assert we have not quietly added one.
check(
    "signature.algorithm is not pinned to an enum in the schema",
    "enum" not in sig_props.get("algorithm", {}),
    "ADR-0002 requires algorithms replaceable via governance; pin them in the registry instead.",
)


# --- The envelope rejects unknown fields, which is what makes the boundary in
# --- ADR-0003 enforceable rather than advisory.
check("envelope rejects unknown fields", schema.get("additionalProperties") is False)
check("signature object rejects unknown fields", sig.get("additionalProperties") is False)
check(
    "signature is required on the envelope",
    "signature" in schema.get("required", []),
)


if failures:
    print(f"FAIL  {len(failures)} of {checks} checks failed\n")
    for f in failures:
        print(f"  FAIL: {f}")
    print("\nSPEC.md and specs/event-envelope.schema.json disagree. Fix one of them.")
    sys.exit(1)

print(f"ok  {checks} checks passed")
print("SPEC.md and specs/event-envelope.schema.json agree.")
