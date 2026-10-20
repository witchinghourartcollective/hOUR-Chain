async function fetchJson(url, { timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchBlockHeader(rpcUrl, height) {
  const query = height ? `?height=${height}` : "";
  const body = await fetchJson(`${rpcUrl}/block${query}`);
  const header = body?.result?.block?.header;
  const blockId = body?.result?.block_id;
  if (!header || !blockId) {
    throw new Error(`Unexpected /block response shape from ${rpcUrl}`);
  }
  return {
    chainId: header.chain_id,
    height: Number(header.height),
    time: header.time,
    appHash: header.app_hash,
    blockHash: blockId.hash,
  };
}

export async function fetchLatestHeight(rpcUrl) {
  const body = await fetchJson(`${rpcUrl}/status`);
  const height = body?.result?.sync_info?.latest_block_height;
  if (!height) throw new Error(`Unexpected /status response shape from ${rpcUrl}`);
  return Number(height);
}

export async function fetchValidatorSet(rpcUrl, height) {
  const query = height ? `?height=${height}` : "";
  const body = await fetchJson(`${rpcUrl}/validators${query}`);
  const validators = body?.result?.validators;
  if (!Array.isArray(validators)) {
    throw new Error(`Unexpected /validators response shape from ${rpcUrl}`);
  }
  return validators.map((v) => ({
    address: v.address,
    votingPower: BigInt(v.voting_power),
  }));
}
