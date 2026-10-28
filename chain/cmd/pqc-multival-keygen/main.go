// Throwaway tool for the multi-validator ML-DSA-65 bandwidth experiment
// (docs/GENESIS-DECISION-GATE.md "1b" follow-up). Not part of the production
// hourd binary. Writes a real ML-DSA-65 priv_validator_key.json + resets
// priv_validator_state.json for one node, and prints the matching
// cosmos-sdk mldsa65 pubkey (base64) for splicing into that node's gentx.
package main

import (
	"encoding/base64"
	"fmt"
	"os"

	cmtmldsa65 "github.com/cometbft/cometbft/crypto/mldsa65"
	"github.com/cometbft/cometbft/privval"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: pqc-multival-keygen <node-evmd-home>")
		os.Exit(1)
	}
	home := os.Args[1]
	keyPath := home + "/config/priv_validator_key.json"
	statePath := home + "/data/priv_validator_state.json"

	privKey := cmtmldsa65.GenPrivKey()
	pv := privval.NewFilePV(privKey, keyPath, statePath)
	pv.Save()

	pubKeyBytes := privKey.PubKey().Bytes()
	fmt.Println("CONS_ADDRESS:", privKey.PubKey().Address().String())
	fmt.Println("PUBKEY_B64:", base64.StdEncoding.EncodeToString(pubKeyBytes))
}
