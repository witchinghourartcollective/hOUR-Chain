# Real-hours pilot runbook: one song, run solo

This runbook takes one real song from your session hours to a reconciled payment on GCUL integration-testing. It uses the real-hours workflow ([TIME-CONTRIBUTIONS.md](TIME-CONTRIBUTIONS.md)), the `hour-time` client, and the GCUL settlement adapter ([ADR-0009](ADR-0009-gcul-settlement-adapter.md)). It is written for one person running every step in Google Cloud Shell, where `ul-cli` and the GCUL accounts are already set up.

GCUL integration-testing uses the DEM test currency, which has no value. The records are real; the money is not.

## Roles

You hold three separate identities, one for each role your businesses actually play:

| Identity | Who | Does |
| --- | --- | --- |
| `fletcher` | you, as producer | Claims your session hours, with the AI disclosure for Google Flow |
| `witchinghour-label` | Witching Hour Music, the label | Reviews your claim, and agrees to pay you for the work |
| `hour-operator` | hOUR Chain's settlement operator | Calculates the obligation and settles it on GCUL |

The payee is `fletcher`. The payment goes to GCUL test account `hour_chain_user2` (`1:USR:DEM:022nXHgAmjMB8mXkdDcqA3HaR9D8EyXD6vAj6urJ7qJ68`), which you control.

**Limits of a solo pilot.** The same person holds every key, so the label's approval is self-approval. This pilot shows the full pipeline with real records: an attributable claim with an AI disclosure, an approved agreement, a calculated obligation, a settled and reconciled payment, and duplicate-payment prevention. It does **not** show independent approval or a dispute between different people. Report it that way, and add a collaborator later to cover those criteria (see the last section).

## 0. Before you start

Merge the open PRs, then update the code:

```
cd ~/hour/hOUR-Chain && git checkout main && git pull
npm test                     # everything should pass
```

Set up a shortcut and one profile per identity. Each profile is a separate directory with its own signing key:

```
alias ht='node ~/hour/hOUR-Chain/packages/time-contributions/bin/hour-time.mjs'
hr()  { HOUR_HOME=~/.hour-"$1" ht "${@:2}"; }      # usage: hr fletcher <command> ...
```

To keep these after Cloud Shell restarts, add both lines to `~/.bashrc`.

## 1. One-time setup

```
hr fletcher keygen --identity fletcher
hr label    keygen --identity witchinghour-label
hr operator keygen --identity hour-operator
```

Each command prints a public key. Every profile has to trust the other two. This loop reads each profile's public key and adds it to the others:

```
for me in fletcher label operator; do
  for other in fletcher label operator; do
    [ "$me" = "$other" ] && continue
    id=$(jq -r .identity ~/.hour-$other/profile.json)
    key=$(jq -r .publicKey ~/.hour-$other/signing-key.json)
    hr $me trust --identity "$id" --public-key "$key"
  done
  hr $me config --store ~/hour-pilot/registry.db --operators hour-operator
done
```

Signing keys are stored with mode 600. Never copy `signing-key.json` anywhere.

## 2. Make the song

Make the track in Google Flow, on the iPhone app or in the browser. Write down:

- when you started and finished (for example `2026-11-25T19:00:00-05:00` to `21:00:00-05:00`);
- what Flow generated (instrumental audio, lyric drafts, vocals) and what you did yourself (prompting, choosing takes, arranging, editing);
- where the Flow project and exports are saved. Keep them private, for example in Drive, and use a reference such as `drive://hour-pilot/song1/flow-export` as the evidence ref.

## 3. Claim your hours (as fletcher)

```
hr fletcher claim --contribution-id contrib-song1-prod --work work-song1 \
  --role producer --activity ai-assisted-production --duration 2h \
  --start 2026-11-25T19:00:00-05:00 --end 2026-11-25T21:00:00-05:00 --timezone America/New_York \
  --evidence drive://hour-pilot/song1/session-notes \
  --reviewers witchinghour-label \
  --ai-tool "Google Flow" --ai-provider Google --ai-model Lyria --ai-output audio,lyrics \
  --ai-use "Generated the instrumental and lyric drafts from my prompts; I chose the takes, arranged and edited them" \
  --ai-evidence drive://hour-pilot/song1/flow-export
```

Adjust `--ai-output` to what Flow actually produced (`audio`, `vocals`, `lyrics`, `composition` and so on). If you need to correct the claim later, re-run it with `--amends`.

## 4. Review the claim (as the label)

```
hr label review --contribution-id contrib-song1-prod --version 1 --approve
hr label disclosure --work work-song1      # should say: AI used: yes (Google Flow; outputs: ...)
```

## 5. Agree on pay (label proposes, both approve)

Choose the basis: a fixed fee (`--fee`), an hourly rate (`--rate-per-hour`), or a revenue share (`--share-bps`, which needs a revenue report). For example, a fixed fee of 250 test units:

```
hr label propose-agreement --agreement-id agree-song1-prod --work work-song1 \
  --contribution-id contrib-song1-prod --payee fletcher --parties fletcher,witchinghour-label \
  --currency DEM --terms-ref drive://hour-pilot/song1/agreement --fee 250
hr fletcher review-agreement --agreement-id agree-song1-prod --version 1 --approve
hr label    review-agreement --agreement-id agree-song1-prod --version 1 --approve
```

## 6. Calculate the obligation and anchor the record (as the operator)

```
hr operator obligation --obligation-id obl-song1-prod \
  --contribution-ref contrib-song1-prod@1 --agreement-ref agree-song1-prod@1
#   prints the amount and "appended obligation.calculated evt-obligation-calculated-..." (keep that event ID)
hr operator head --record
```

`head --record` makes every later operator command refuse a log that no longer contains this point. Also copy the printed `{seq, hash}` somewhere outside Cloud Shell, for example an email to yourself, because an anchor kept only on the same machine does not protect against that machine.

## 7. Create the settlement instruction (as the operator)

```
hr operator instruction --obligation <obligation event ID> \
  --payee-account 1:USR:DEM:022nXHgAmjMB8mXkdDcqA3HaR9D8EyXD6vAj6urJ7qJ68 \
  --currency DEM --out ~/hour-pilot/instruction-song1.json
```

## 8. Settle on GCUL

Map the payee identity to the GCUL account and its local `ul-cli` alias:

```
cat > ~/hour-pilot/payees.json <<'EOF'
{ "fletcher": { "account": "1:USR:DEM:022nXHgAmjMB8mXkdDcqA3HaR9D8EyXD6vAj6urJ7qJ68", "alias": "hour_chain_user2" } }
EOF
```

Dry run first. It verifies everything, sends nothing, and shows the leg it would pay:

```
node ~/hour/hOUR-Chain/packages/gcul-adapter/scripts/settle.mjs \
  --instruction ~/hour-pilot/instruction-song1.json \
  --operator-home ~/.hour-operator --payees ~/hour-pilot/payees.json
```

Check that the payee and amount are right, then pay:

```
node ~/hour/hOUR-Chain/packages/gcul-adapter/scripts/settle.mjs \
  --instruction ~/hour-pilot/instruction-song1.json \
  --operator-home ~/.hour-operator --payees ~/hour-pilot/payees.json --live
```

Expected output: the leg `CONFIRMED` with a transaction hash, the operator's balance down by the amount, and a reconciliation report with one receipt (`finality: final`). Earlier test receipts on the contract are listed as `known-pre-adapter`. Running the same command again must report the leg as not submitted, with no second payment.

Evidence for each run is written to `~/.local/state/hour-gcul/settlements/`.

The runner checks that each local payee alias resolves to its approved account and accepts only DEM instructions. A live run exits nonzero if a requested leg is not reconciled; inspect its evidence before acting. Rerunning resolves `UNKNOWN` legs from the ledger without sending a payment. To retry a `FAILED` leg after correcting its cause, add `--retry-failed`; the original settlement ID is reused. For a `SUBMITTING` leg, first confirm the previous worker has stopped (an expired lease alone is not proof), then add `--recover-submitting` to resolve it from the ledger. An unexpired lease still blocks recovery. Add `--retry-failed` separately if a resolved leg needs a retry.

## 9. Record and report

- Add the evidence to `docs/evidence/` and a summary to `docs/GCUL-INTEGRATION-TESTING.md`. Label it **real records, solo, integration-testing (no-value currency)**.
- Optionally send Google a short update in the existing thread with the transaction hash.

## Later: adding a real collaborator

A collaborator installs Node 24.7 or newer, clones this repository, runs `hour-time keygen --identity <name>`, and sends you their public key. You run `trust` for them in each profile. They sign with `--out file.json` and send you the file, and you `append` it. With them as a reviewer or agreement party, the pilot also shows independent approval, and a dispute followed by a correction.
