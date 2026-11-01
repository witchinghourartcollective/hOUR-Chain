import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRuntime } from '../scripts/check-runtime.mjs';

test('missing runtime configuration fails closed without claiming workflow completion', async () => {
  const result = await checkRuntime({});
  assert.equal(result.endpointChecksPassed, false);
  assert.equal(result.creatorWorkflowVerified, false);
  assert.equal(result.checks.length, 4);
  assert.ok(result.checks.every(c => !c.ok));
});

test('reject wrong chain, stale block and syncing Cosmos nodes', async () => {
  for (const patch of [{ network: 'wrong' }, { time: '2020-01-01' }, { catching: true }]) {
    const result = await checkRuntime({ cosmos: { rpc: 'http://node:26657', chainId: 'hour_9000-1' } }, {
      now: Date.parse('2026-11-01T12:00:00Z'),
      get: async () => ({ result: { node_info: { network: patch.network ?? 'hour_9000-1' }, sync_info: {
        catching_up: patch.catching ?? false, latest_block_height: '10',
        latest_block_time: patch.time ?? '2026-11-01T12:00:00Z',
      } } }),
    });
    assert.equal(result.checks.find(c => c.name === 'cosmos').ok, false);
  }
});

test('placeholder Solana ID and Base EOA cannot pass deployment checks', async () => {
  const result = await checkRuntime({ solana: { programId: 'HbcCons111111111111111111111111111111111111' },
    base: { rpc: 'http://base', tokenAddress: '0x' + '1'.repeat(40) } }, {
    call: async (_, method) => method === 'eth_chainId' ? '0x2105' : '0x',
  });
  assert.match(result.checks.find(c => c.name === 'solana').error, /Placeholder/);
  assert.equal(result.checks.find(c => c.name === 'base').ok, false);
});

test('closed IBC channels and expired clients fail before any packet-delivery claim', async () => {
  const sides = ['hour', 'other'].map((chainId, i) => ({ chainId, rest: `http://${chainId}`,
    portId: 'transfer', channelId: `channel-${i}` }));
  for (const active of [false, true]) {
    const result = await checkRuntime({ cosmos: { chainId: 'hour' }, ibc: { sides } }, { get: async url => {
      if (url.endsWith('/syncing')) return { syncing: false };
      if (url.endsWith('/blocks/latest')) return { block: { header: {
        chain_id: 'hour', height: '10', time: new Date().toISOString(),
      } } };
      if (url.includes('/channels/')) return { channel: { state: active ? 'STATE_OPEN' : 'STATE_CLOSED',
        counterparty: { channel_id: 'channel-1', port_id: 'transfer' }, connection_hops: ['connection-0'] } };
      if (url.includes('/connections/')) return { connection: { state: 'STATE_OPEN', client_id: '07-tendermint-0' } };
      if (url.includes('/client_states/')) return { client_state: { chain_id: 'other',
        frozen_height: { revision_height: '0', revision_number: '0' } } };
      if (url.includes('/client_status/')) return { status: 'Expired' };
      throw new Error('unexpected request');
    } });
    assert.equal(result.checks.find(c => c.name === 'ibc').ok, false);
  }
});

test('healthy endpoints and matching active IBC sides still do not attest packet delivery', async () => {
  const sides = ['hour', 'other'].map((chainId, i) => ({ chainId, rest: `http://${chainId}`,
    portId: 'transfer', channelId: `channel-${i}` }));
  const result = await checkRuntime({ cosmos: { chainId: 'hour', rpc: 'http://hour' }, ibc: { sides },
    solana: { programId: 'real-program', rpc: 'http://solana', genesisHash: 'expected' },
    base: { rpc: 'http://base', tokenAddress: '0x' + '1'.repeat(40) } }, {
    now: Date.parse('2026-11-01T12:00:00Z'),
    get: async url => {
      const i = url.startsWith('http://hour') ? 0 : 1;
      if (url.endsWith('/status')) return { result: { node_info: { network: 'hour' }, sync_info: {
        catching_up: false, latest_block_height: '10', latest_block_time: '2026-11-01T12:00:00Z',
      } } };
      if (url.endsWith('/syncing')) return { syncing: false };
      if (url.endsWith('/blocks/latest')) return { sdk_block: { header: {
        chain_id: sides[i].chainId, height: '10', time: '2026-11-01T12:00:00Z',
      } } };
      if (url.includes('/channels/')) return { channel: { state: 'STATE_OPEN',
        counterparty: { channel_id: `channel-${1-i}`, port_id: 'transfer' }, connection_hops: [`connection-${i}`] } };
      if (url.includes('/connections/')) return { connection: { state: 'STATE_OPEN', client_id: `07-tendermint-${i}`,
        counterparty: { connection_id: `connection-${1-i}` } } };
      if (url.includes('/client_states/')) return { client_state: { chain_id: sides[1-i].chainId,
        frozen_height: { revision_height: '0', revision_number: '0' } } };
      if (url.includes('/client_status/')) return { status: 'Active' };
      if (url.endsWith('/node_info')) return { default_node_info: { network: sides[i].chainId } };
      throw new Error('unexpected request');
    },
    call: async (_, method) => ({ getGenesisHash: 'expected', getAccountInfo: { value: { executable: true,
      owner: 'BPFLoaderUpgradeab1e11111111111111111111111' } }, eth_chainId: '0x2105', eth_getCode: '0xabcd' })[method],
  });
  assert.equal(result.endpointChecksPassed, true);
  assert.equal(result.creatorWorkflowVerified, false);
  assert.equal(result.checks.find(c => c.name === 'ibc').evidence.packetDeliveryVerified, false);
});

test('query-routed endpoints preserve query parameters and clear fragments', async () => {
  let observed;
  await checkRuntime({ cosmos: { chainId: 'hour', rpc: 'https://node.example/rpc?network=hour#fragment' } }, {
    get: async url => { observed = new URL(url); throw new Error('fixture'); },
  });
  assert.equal(observed.pathname, '/rpc/status');
  assert.equal(observed.searchParams.get('network'), 'hour');
  assert.equal(observed.hash, '');
});

test('fresh Cosmos RPC cannot hide stale IBC REST state', async () => {
  const sides = ['hour', 'other'].map((chainId, i) => ({ chainId, rest: `http://${chainId}`,
    portId: 'transfer', channelId: `channel-${i}` }));
  const result = await checkRuntime({ cosmos: { chainId: 'hour', rpc: 'http://hour' }, ibc: { sides } }, {
    now: Date.parse('2026-11-01T12:00:00Z'), get: async url => {
      if (url.endsWith('/status')) return { result: { node_info: { network: 'hour' }, sync_info: {
        catching_up: false, latest_block_height: '10', latest_block_time: '2026-11-01T12:00:00Z',
      } } };
      if (url.endsWith('/syncing')) return { syncing: false };
      if (url.endsWith('/blocks/latest')) return { block: { header: {
        chain_id: 'hour', height: '1', time: '2026-10-01T12:00:00Z',
      } } };
      throw new Error('must reject stale REST before querying IBC state');
    },
  });
  assert.equal(result.checks.find(c => c.name === 'cosmos').ok, true);
  assert.match(result.checks.find(c => c.name === 'ibc').error, /stale/);
});
