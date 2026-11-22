#!/usr/bin/env bash
# One-shot, idempotent setup for Universal Ledger tooling in Cloud Shell.
# Safe to re-run any time (e.g. after the VM resets). Run: bash scripts/gcul/setup-cloudshell.sh (from the hOUR-Chain repo root)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PROJECT=hour-blockchain
ENDPOINT=projects/$PROJECT/locations/us-east4/endpoints/integration-testing
OWNER_KEY=projects/$PROJECT/locations/global/keyRings/hour-chain-gcul/cryptoKeys/hour-chain-owner/cryptoKeyVersions/1
UL_IMG=us-central1-docker.pkg.dev/universal-ledger-artifacts/release/ul-cli:stable
PYC_IMG=us-docker.pkg.dev/gcul-artifacts/images/client/gculpyc:stable

KEYRING=projects/$PROJECT/locations/global/keyRings/hour-chain-gcul/cryptoKeys
# alias -> "account_id kms_key_version" (local address book entries)
declare -A ACCOUNTS=(
  [hour_chain_owner]="1:USR:DEM:0256bBuqu4nuCNRud1CMwF5FFtm4LdRyD8X8UCYNgyGa9 $OWNER_KEY"
  [hour_chain_act]="1:ACT:DEM:025eeYJgWAZKZavZFrePPJ3oDfHRwYe3BR5Vk52yCvRdc $OWNER_KEY"
  [hour_chain_user2]="1:USR:DEM:022nXHgAmjMB8mXkdDcqA3HaR9D8EyXD6vAj6urJ7qJ68 $KEYRING/hour-chain-user2/cryptoKeyVersions/1"
)

echo "==> gcloud project + docker auth"
gcloud config set project "$PROJECT" >/dev/null 2>&1 || true
gcloud auth configure-docker us-central1-docker.pkg.dev,us-docker.pkg.dev --quiet >/dev/null 2>&1 || true

echo "==> pulling images"
docker pull -q "$UL_IMG" >/dev/null
docker pull -q "$PYC_IMG" >/dev/null || echo "   (gculpyc pull failed; skipping)"

echo "==> installing wrappers into ~/bin"
mkdir -p ~/bin ~/.config/ul-cli
install -m 755 "$HERE/ul-cli.wrapper" ~/bin/ul-cli
cat > ~/bin/gculpyc <<PYC
#!/usr/bin/env bash
exec docker run --rm -i --user "\$(id -u):\$(id -g)" -v "\$PWD:/workspace" -w /workspace $PYC_IMG "\$@"
PYC
chmod 755 ~/bin/gculpyc
grep -q 'HOME/bin' ~/.bashrc || echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
export PATH="$HOME/bin:$PATH"

cd ~
echo "==> ul-cli config"
if ! grep -q "endpoint: integration-testing" ~/.config/ul-cli/config.yaml 2>/dev/null; then
  ul-cli --timeout 90s config setup "$ENDPOINT"
fi

echo "==> registering account aliases"
existing="$(ul-cli accounts list 2>/dev/null || true)"
for alias in "${!ACCOUNTS[@]}"; do
  if grep -q "\"$alias\"" <<<"$existing"; then
    echo "   $alias already registered"
  else
    read -r id key <<<"${ACCOUNTS[$alias]}"
    ul-cli --timeout 90s accounts register --alias "$alias" --account-id "$id" --key-name "$key" | tail -1
  fi
done

echo "==> connectivity check"
ul-cli --timeout 90s accounts describe --alias hour_chain_owner --sender hour_chain_owner | grep -E 'Account:|Balance|status' || true

echo
echo "Done. Open terminals need: source ~/.bashrc   (new terminals pick it up automatically)"
