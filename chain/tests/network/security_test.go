//go:build !norace
// +build !norace

package network

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	"github.com/cosmos/evm/testutil/constants"
	feemarkettypes "github.com/cosmos/evm/x/feemarket/types"
	evmtypes "github.com/cosmos/evm/x/vm/types"
	"github.com/stretchr/testify/require"
)

func TestDefaultJSONRPCNamespacesAreLeastPrivilege(t *testing.T) {
	require.Equal(t, []string{"eth", "net", "web3"}, defaultJSONRPCNamespaces)
}

func TestDefaultConfigContainsEVMFeeDenomMetadata(t *testing.T) {
	cfg := DefaultConfig()
	require.Equal(t, uint64(9000), cfg.EVMChainID)
	var bankGenesis banktypes.GenesisState
	cfg.Codec.MustUnmarshalJSON(cfg.GenesisState[banktypes.ModuleName], &bankGenesis)
	wantDenom := constants.ChainsCoinInfo[evmtypes.DefaultEVMChainID].Denom
	found := false
	for _, metadata := range bankGenesis.DenomMetadata {
		if metadata.Base == wantDenom {
			found = true
			break
		}
	}
	require.True(t, found, "EVM fee denom metadata %q must be in genesis", wantDenom)
	var evmGenesis evmtypes.GenesisState
	cfg.Codec.MustUnmarshalJSON(cfg.GenesisState[evmtypes.ModuleName], &evmGenesis)
	require.Equal(t, wantDenom, evmGenesis.Params.EvmDenom)
	var feeMarketGenesis feemarkettypes.GenesisState
	cfg.Codec.MustUnmarshalJSON(cfg.GenesisState[feemarkettypes.ModuleName], &feeMarketGenesis)
	require.True(t, feeMarketGenesis.Params.NoBaseFee)
	cfg.NumValidators = 1
	genesisPath := filepath.Join(t.TempDir(), "genesis.json")
	require.NoError(t, initGenFiles(cfg, nil, nil, []string{genesisPath}))
	data, err := os.ReadFile(genesisPath)
	require.NoError(t, err)
	var genesisDoc struct {
		AppState json.RawMessage `json:"app_state"`
	}
	require.NoError(t, json.Unmarshal(data, &genesisDoc))
	var appState map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(genesisDoc.AppState, &appState))
	var generatedBankGenesis banktypes.GenesisState
	cfg.Codec.MustUnmarshalJSON(appState[banktypes.ModuleName], &generatedBankGenesis)
	generatedFound := false
	for _, metadata := range generatedBankGenesis.DenomMetadata {
		if metadata.Base == wantDenom {
			generatedFound = true
			break
		}
	}
	require.True(t, generatedFound, "generated genesis must retain EVM fee denom metadata %q", wantDenom)
}

func TestGetFreeTCPPortReturnsAvailableLoopbackPort(t *testing.T) {
	port, err := getFreeTCPPort()
	require.NoError(t, err)
	parsedPort, err := strconv.Atoi(port)
	require.NoError(t, err)
	require.Greater(t, parsedPort, 0)
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", port))
	require.NoError(t, err)
	require.NoError(t, listener.Close())
}
