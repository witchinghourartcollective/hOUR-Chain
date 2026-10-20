package evmd

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"

	"cosmossdk.io/math"
	abci "github.com/cometbft/cometbft/abci/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	testconstants "github.com/cosmos/evm/testutil/constants"
	"github.com/cosmos/evm/testutil/integration/evm/network"
	feemarkettypes "github.com/cosmos/evm/x/feemarket/types"
	evmtypes "github.com/cosmos/evm/x/vm/types"
	transfertypes "github.com/cosmos/ibc-go/v11/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v11/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v11/modules/core/04-channel/types"
	ibctesting "github.com/cosmos/ibc-go/v11/testing"
	ibcsimapp "github.com/cosmos/ibc-go/v11/testing/simapp"
)

// The EVM package initializes process-global configuration once per app. Use
// one hOUR app and one upstream IBC test app so the test covers a real transfer
// without constructing a second EVM app in the same process.
type ibcTestingApp struct{ *EVMD }

func (app ibcTestingApp) InitChain(req *abci.RequestInitChain) (*abci.ResponseInitChain, error) {
	var genesis map[string]json.RawMessage
	if err := json.Unmarshal(req.AppStateBytes, &genesis); err != nil {
		return nil, err
	}
	var bankGenesis banktypes.GenesisState
	app.AppCodec().MustUnmarshalJSON(genesis[banktypes.ModuleName], &bankGenesis)
	bankGenesis.DenomMetadata = network.GenerateBankGenesisMetadata(evmtypes.DefaultEVMChainID)
	genesis[banktypes.ModuleName] = app.AppCodec().MustMarshalJSON(&bankGenesis)
	var evmGenesis evmtypes.GenesisState
	app.AppCodec().MustUnmarshalJSON(genesis[evmtypes.ModuleName], &evmGenesis)
	evmGenesis.Params.EvmDenom = testconstants.ChainsCoinInfo[evmtypes.DefaultEVMChainID].Denom
	genesis[evmtypes.ModuleName] = app.AppCodec().MustMarshalJSON(&evmGenesis)
	var feeMarketGenesis feemarkettypes.GenesisState
	app.AppCodec().MustUnmarshalJSON(genesis[feemarkettypes.ModuleName], &feeMarketGenesis)
	feeMarketGenesis.Params.NoBaseFee = true
	genesis[feemarkettypes.ModuleName] = app.AppCodec().MustMarshalJSON(&feeMarketGenesis)
	patched, err := json.Marshal(genesis)
	if err != nil {
		return nil, err
	}
	req.AppStateBytes = patched
	return app.GetBaseApp().InitChain(req)
}

func TestICS20TransferAndTimeoutRefund(t *testing.T) {
	coordinator := &ibctesting.Coordinator{
		T:           t,
		CurrentTime: time.Date(2020, 1, 2, 0, 0, 0, 0, time.UTC),
		Chains:      make(map[string]*ibctesting.TestChain),
	}
	chainA := ibctesting.NewCustomAppTestChain(t, coordinator, ibctesting.GetChainID(1), func() (ibctesting.TestingApp, map[string]json.RawMessage) {
		app, genesis := SetupTestingApp(ibctesting.GetChainID(1))()
		return ibcTestingApp{app.(*EVMD)}, genesis
	})
	coordinator.Chains[chainA.ChainID] = chainA
	chainB := ibctesting.NewTestChain(t, coordinator, ibctesting.GetChainID(2))
	coordinator.Chains[chainB.ChainID] = chainB

	path := ibctesting.NewTransferPath(chainA, chainB)
	path.Setup()

	bankA := chainA.App.(ibcTestingApp).BankKeeper
	sender := chainA.SenderAccount.GetAddress()
	initialBalance := bankA.GetBalance(chainA.GetContext(), sender, sdk.DefaultBondDenom)
	transfer := func(amount int64, timeoutHeight clienttypes.Height) channeltypes.Packet {
		t.Helper()
		msg := transfertypes.NewMsgTransfer(
			path.EndpointA.ChannelConfig.PortID,
			path.EndpointA.ChannelID,
			sdk.NewInt64Coin(sdk.DefaultBondDenom, amount),
			sender.String(),
			chainB.SenderAccount.GetAddress().String(),
			timeoutHeight,
			0,
			"",
		)
		result, err := chainA.SendMsgs(msg)
		if err != nil {
			t.Fatalf("send ICS-20 transfer: %v", err)
		}
		packet, err := ibctesting.ParseV1PacketFromEvents(result.Events)
		if err != nil {
			t.Fatalf("parse ICS-20 packet: %v", err)
		}
		return packet
	}

	amount := int64(12345)
	packet := transfer(amount, clienttypes.NewHeight(1, uint64(chainB.App.LastBlockHeight()+100)))
	_, acknowledgementBytes, err := path.RelayPacketWithResults(packet)
	if err != nil {
		t.Fatalf("relay ICS-20 packet: %v", err)
	}
	expectedAcknowledgement := channeltypes.NewResultAcknowledgement([]byte{1}).Acknowledgement()
	if !bytes.Equal(acknowledgementBytes, expectedAcknowledgement) {
		t.Fatalf("ICS-20 transfer acknowledgement = %q, want success acknowledgement %q", acknowledgementBytes, expectedAcknowledgement)
	}
	if commitment := chainA.App.GetIBCKeeper().ChannelKeeper.GetPacketCommitment(chainA.GetContext(), packet.GetSourcePort(), packet.GetSourceChannel(), packet.GetSequence()); len(commitment) != 0 {
		t.Fatalf("acknowledged packet commitment remains: %x", commitment)
	}
	trace := transfertypes.NewDenom(sdk.DefaultBondDenom, transfertypes.NewHop(path.EndpointB.ChannelConfig.PortID, path.EndpointB.ChannelID))
	finalVoucher := chainB.App.(*ibcsimapp.SimApp).BankKeeper.GetAllBalances(chainB.GetContext(), chainB.SenderAccount.GetAddress())
	if !finalVoucher.AmountOf(trace.IBCDenom()).Equal(math.NewInt(amount)) {
		t.Fatalf("destination voucher balance = %s, want %d%s", finalVoucher, amount, trace.IBCDenom())
	}

	refundAmount := int64(23456)
	timeoutHeight := clienttypes.NewHeight(1, uint64(chainB.App.LastBlockHeight()+1))
	timeoutPacket := transfer(refundAmount, timeoutHeight)
	coordinator.CommitBlock(chainB)
	if err := path.EndpointA.UpdateClient(); err != nil {
		t.Fatalf("update source client before timeout: %v", err)
	}
	if err := path.EndpointA.TimeoutPacket(timeoutPacket); err != nil {
		t.Fatalf("timeout ICS-20 packet and refund source: %v", err)
	}
	if commitment := chainA.App.GetIBCKeeper().ChannelKeeper.GetPacketCommitment(chainA.GetContext(), timeoutPacket.GetSourcePort(), timeoutPacket.GetSourceChannel(), timeoutPacket.GetSequence()); len(commitment) != 0 {
		t.Fatalf("timed-out packet commitment remains: %x", commitment)
	}

	finalBalance := bankA.GetBalance(chainA.GetContext(), sender, sdk.DefaultBondDenom)
	expected := initialBalance.Amount.SubRaw(amount)
	if !finalBalance.Amount.Equal(expected) {
		t.Fatalf("source balance after timeout = %s, want %s", finalBalance, sdk.NewCoin(sdk.DefaultBondDenom, expected))
	}
	escrowAddress := transfertypes.GetEscrowAddress(path.EndpointA.ChannelConfig.PortID, path.EndpointA.ChannelID)
	escrowBalance := bankA.GetBalance(chainA.GetContext(), escrowAddress, sdk.DefaultBondDenom)
	if !escrowBalance.Amount.Equal(math.NewInt(amount)) {
		t.Fatalf("source escrow after ack and timeout = %s, want %s", escrowBalance, sdk.NewInt64Coin(sdk.DefaultBondDenom, amount))
	}

	returnMsg := transfertypes.NewMsgTransfer(
		path.EndpointB.ChannelConfig.PortID,
		path.EndpointB.ChannelID,
		sdk.NewInt64Coin(trace.IBCDenom(), amount),
		chainB.SenderAccount.GetAddress().String(),
		sender.String(),
		clienttypes.NewHeight(1, uint64(chainA.App.LastBlockHeight()+100)),
		0,
		"",
	)
	returnResult, err := chainB.SendMsgs(returnMsg)
	if err != nil {
		t.Fatalf("send ICS-20 return transfer: %v", err)
	}
	returnPacket, err := ibctesting.ParseV1PacketFromEvents(returnResult.Events)
	if err != nil {
		t.Fatalf("parse ICS-20 return packet: %v", err)
	}
	_, returnAcknowledgement, err := path.RelayPacketWithResults(returnPacket)
	if err != nil {
		t.Fatalf("relay ICS-20 return packet: %v", err)
	}
	if !bytes.Equal(returnAcknowledgement, expectedAcknowledgement) {
		t.Fatalf("ICS-20 return acknowledgement = %q, want success acknowledgement %q", returnAcknowledgement, expectedAcknowledgement)
	}
	returnedBalance := bankA.GetBalance(chainA.GetContext(), sender, sdk.DefaultBondDenom)
	if !returnedBalance.IsEqual(initialBalance) {
		t.Fatalf("hOUR balance after return transfer = %s, want %s", returnedBalance, initialBalance)
	}
	finalEscrowBalance := bankA.GetBalance(chainA.GetContext(), escrowAddress, sdk.DefaultBondDenom)
	if !finalEscrowBalance.IsZero() {
		t.Fatalf("source escrow after round trip = %s, want zero", finalEscrowBalance)
	}
}
