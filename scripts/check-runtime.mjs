import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}
function endpoint(base, path) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP(S) endpoint required');
  url.pathname = url.pathname.replace(/\/$/, '') + path;
  url.hash = '';
  return url.href;
}
async function request(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  if (result.error) throw new Error('RPC returned an error');
  return result;
}
const rpc = async (url, method, params) => (await request(url, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
})).result;

export async function checkRuntime(config, { get = request, call = rpc, now = Date.now() } = {}) {
  const checks = [];
  async function check(name, fn) {
    try { checks.push({ name, ok: true, evidence: await fn() }); }
    catch (error) { checks.push({ name, ok: false, error: error.message }); }
  }
  await check('cosmos', async () => {
    const c = config.cosmos;
    const expected = required(c?.chainId, 'Cosmos chain ID');
    const { result } = await get(endpoint(required(c?.rpc, 'Cosmos RPC'), '/status'));
    const s = result?.sync_info;
    const age = now - Date.parse(s?.latest_block_time);
    if (result?.node_info?.network !== expected || s?.catching_up !== false ||
        !/^\d+$/.test(s?.latest_block_height ?? '') || BigInt(s.latest_block_height) <= 0n ||
        !Number.isFinite(age) || age < -30000 || age > 120000) {
      throw new Error('Wrong chain, unsynchronized node, or stale/invalid block');
    }
    return { chainId: expected, height: s.latest_block_height, latestBlockTime: s.latest_block_time };
  });
  await check('ibc', async () => {
    const sides = config.ibc?.sides;
    if (!Array.isArray(sides) || sides.length !== 2) throw new Error('Two explicit IBC Classic sides required');
    if (!sides.some(s => s.chainId === config.cosmos?.chainId)) throw new Error('IBC route must include the configured hOUR chain');
    const evidence = [];
    for (const [i, side] of sides.entries()) {
      const other = sides[1 - i];
      const rest = required(side.rest, 'IBC REST endpoint');
      const chain = required(side.chainId, 'IBC chain ID');
      const port = required(side.portId, 'IBC port ID');
      const channel = required(side.channelId, 'IBC channel ID');
      const syncing = await get(endpoint(rest, '/cosmos/base/tendermint/v1beta1/syncing'));
      const latest = await get(endpoint(rest, '/cosmos/base/tendermint/v1beta1/blocks/latest'));
      const header = (latest.sdk_block ?? latest.block)?.header;
      const age = now - Date.parse(header?.time);
      if (syncing.syncing !== false || header?.chain_id !== chain ||
          !/^\d+$/.test(header?.height ?? '') || BigInt(header.height) <= 0n ||
          !Number.isFinite(age) || age < -30000 || age > 120000) {
        throw new Error('IBC REST node is unsynchronized, stale or on the wrong chain');
      }
      const enc = encodeURIComponent;
      const ch = (await get(endpoint(rest, `/ibc/core/channel/v1/channels/${enc(channel)}/ports/${enc(port)}`))).channel;
      if (ch?.state !== 'STATE_OPEN' || ch.counterparty?.channel_id !== other.channelId ||
          ch.counterparty?.port_id !== other.portId || ch.connection_hops?.length !== 1) {
        throw new Error('IBC channel is not OPEN or counterparties do not match');
      }
      const connectionId = ch.connection_hops[0];
      const con = (await get(endpoint(rest, `/ibc/core/connection/v1/connections/${enc(connectionId)}`))).connection;
      if (con?.state !== 'STATE_OPEN') throw new Error('IBC connection is not OPEN');
      const clientId = required(con.client_id, 'IBC client ID');
      const state = (await get(endpoint(rest, `/ibc/core/client/v1/client_states/${enc(clientId)}`))).client_state;
      if (state?.chain_id !== other.chainId || !state.frozen_height ||
          String(state.frozen_height.revision_height) !== '0' || String(state.frozen_height.revision_number) !== '0') {
        throw new Error('Wrong or frozen IBC Tendermint client');
      }
      const status = (await get(endpoint(rest, `/ibc/core/client/v1/client_status/${enc(clientId)}`))).status;
      if (status !== 'Active') throw new Error('IBC client is not Active (possibly expired)');
      const node = (await get(endpoint(rest, '/cosmos/base/tendermint/v1beta1/node_info'))).default_node_info;
      if (node?.network !== chain) throw new Error('IBC REST endpoint belongs to the wrong chain');
      evidence.push({ chainId: chain, portId: port, channelId: channel, connectionId, clientId,
        counterpartyConnectionId: con.counterparty?.connection_id });
    }
    if (evidence[0].chainId === evidence[1].chainId ||
        evidence[0].counterpartyConnectionId !== evidence[1].connectionId ||
        evidence[1].counterpartyConnectionId !== evidence[0].connectionId) {
      throw new Error('IBC connection counterparties do not match');
    }
    return { sides: evidence, packetDeliveryVerified: false };
  });
  await check('solana', async () => {
    const s = config.solana;
    const programId = required(s?.programId, 'Deployed Solana program ID');
    if (programId === 'HbcCons111111111111111111111111111111111111') throw new Error('Placeholder Solana program ID');
    const expected = required(s?.genesisHash, 'Expected Solana genesis hash');
    if (await call(required(s.rpc, 'Solana RPC'), 'getGenesisHash', []) !== expected) throw new Error('Wrong Solana cluster');
    const value = (await call(s.rpc, 'getAccountInfo', [programId, { encoding: 'base64', commitment: 'finalized' }]))?.value;
    const loaders = ['BPFLoaderUpgradeab1e11111111111111111111111', 'BPFLoader2111111111111111111111111111111111'];
    if (value?.executable !== true || !loaders.includes(value.owner)) throw new Error('No executable Solana program at configured address');
    return { programId, owner: value.owner, consentWorkflowVerified: false };
  });
  await check('base', async () => {
    const b = config.base;
    const url = required(b?.rpc, 'Base RPC');
    const address = required(b?.tokenAddress, 'Base token address');
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error('Invalid Base address');
    if (await call(url, 'eth_chainId', []) !== '0x2105') throw new Error('Wrong Base chain (expected 8453)');
    const code = await call(url, 'eth_getCode', [address, 'latest']);
    if (typeof code !== 'string' || !/^0x(?:[a-fA-F0-9]{2})+$/.test(code)) throw new Error('No Base contract bytecode');
    return { tokenAddress: address, chainId: 8453, royaltySettlementVerified: false };
  });
  // These probes cannot attest to Filecoin storage, packet delivery or consent acceptance.
  return { checkedAt: new Date(now).toISOString(), endpointChecksPassed: checks.every(c => c.ok),
    creatorWorkflowVerified: false, checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await checkRuntime(JSON.parse(await readFile(process.argv[2], 'utf8')));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.endpointChecksPassed ? 0 : 1;
  } catch {
    console.error('Usage: node scripts/check-runtime.mjs <non-secret-config.json>');
    process.exitCode = 1;
  }
}
