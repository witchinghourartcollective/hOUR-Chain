package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTestnetJSONRPCNamespacesExcludePrivilegedAPIs(t *testing.T) {
	require.Equal(t, []string{"eth", "net", "web3"}, defaultTestnetJSONRPCApis)
}

func TestInProcessTestnetRPCDefaultsToLoopback(t *testing.T) {
	cmd := testnetStartCmd()
	require.Equal(t, "tcp://127.0.0.1:26657", cmd.Flags().Lookup(flagRPCAddress).DefValue)
	require.Equal(t, "tcp://127.0.0.1:1317", cmd.Flags().Lookup(flagAPIAddress).DefValue)
	require.Equal(t, "127.0.0.1:9090", cmd.Flags().Lookup(flagGRPCAddress).DefValue)
	require.Equal(t, "127.0.0.1:8545", cmd.Flags().Lookup(flagJSONRPCAddress).DefValue)
}

func TestWriteSecretFileUsesPrivatePermissions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "key_seed.json")
	require.NoError(t, writeSecretFile("key_seed.json", dir, []byte(`{"secret":"test-only"}`)))
	info, err := os.Stat(path)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0o600), info.Mode().Perm())
}

func TestParseValidatorPowers(t *testing.T) {
	tests := []struct {
		name          string
		powers        []int
		numValidators int
		want          []int64
		wantErr       bool
	}{
		{
			name:          "empty slice - use defaults",
			powers:        []int{},
			numValidators: 4,
			want:          []int64{100, 100, 100, 100},
			wantErr:       false,
		},
		{
			name:          "nil slice - use defaults",
			powers:        nil,
			numValidators: 4,
			want:          []int64{100, 100, 100, 100},
			wantErr:       false,
		},
		{
			name:          "exact number of powers",
			powers:        []int{100, 200, 150, 300},
			numValidators: 4,
			want:          []int64{100, 200, 150, 300},
			wantErr:       false,
		},
		{
			name:          "fewer powers than validators",
			powers:        []int{100, 200},
			numValidators: 5,
			want:          []int64{100, 200, 200, 200, 200},
			wantErr:       false,
		},
		{
			name:          "single power for all validators",
			powers:        []int{500},
			numValidators: 3,
			want:          []int64{500, 500, 500},
			wantErr:       false,
		},
		{
			name:          "more powers than validators",
			powers:        []int{100, 200, 300, 400},
			numValidators: 2,
			want:          []int64{100, 200},
			wantErr:       false,
		},
		{
			name:          "invalid power - negative",
			powers:        []int{100, -200, 300},
			numValidators: 3,
			want:          nil,
			wantErr:       true,
		},
		{
			name:          "invalid power - zero",
			powers:        []int{100, 0, 300},
			numValidators: 3,
			want:          nil,
			wantErr:       true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseValidatorPowers(tt.powers, tt.numValidators)
			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				require.Equal(t, tt.want, got)
			}
		})
	}
}
