// Shared client helpers for the deploy/smoke scripts and the autonomous agents.
//
// Select the network with NETWORK=studionext | localnet | testnet
// (default: studionext). Burner accounts are funded via sim_fundAccount on
// localnet/Studio; pass funded keys (PRIVATE_KEY, REQUESTER_KEY, WORKER_KEY)
// to reuse an existing account.
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js'
import { localnet, studioDevnet, testnetBradbury } from 'genlayer-js/chains'

// GenLayer Studio Next (chain 61997, studio-dev.genlayer.com) is the
// `studioDevnet` preset in genlayer-js 2.x; add its explorer for tx links.
export const studioNext = {
  ...studioDevnet,
  name: 'GenLayer Studio Next',
  blockExplorers: {
    default: { name: 'Studio Next Explorer', url: 'https://explorer-studio-dev.genlayer.com' },
  },
}

const NETWORKS = { studionext: studioNext, localnet, testnet: testnetBradbury }
export const NETWORK_ID = process.env.NETWORK || 'studionext'
export const NETWORK = NETWORKS[NETWORK_ID]
if (!NETWORK) {
  throw new Error(`Unknown NETWORK=${NETWORK_ID} (use studionext | localnet | testnet)`)
}

export function makeAccount(key) {
  return createAccount(key || generatePrivateKey())
}

export function makeClient(account) {
  return createClient({ chain: NETWORK, account })
}

export function explorerTx(hash) {
  const url = NETWORK.blockExplorers?.default?.url
  return url ? `${url.replace(/\/$/, '')}/tx/${hash}` : hash
}

export async function fund(client, address, gen = 100) {
  // Localnet and Studio expose sim_fundAccount; Bradbury needs the faucet.
  // Call it over raw JSON-RPC: genlayer-js only allows fundAccount on localnet.
  if (NETWORK.id === testnetBradbury.id) return false
  try {
    const res = await fetch(NETWORK.rpcUrls.default.http[0], {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sim_fundAccount',
        params: [address, Number(BigInt(gen) * 10n ** 18n)],
      }),
    })
    const body = await res.json()
    return !body.error
  } catch {
    return false
  }
}

// Every GenLayer transaction carries a fee distribution; derive it from the
// network's active fee policy (required on Studio Next).
export function estimateFees(client) {
  return client.estimateTransactionFees({})
}

export async function write(client, contract, functionName, args, value = 0n) {
  const hash = await client.writeContract({
    address: contract,
    functionName,
    args,
    value,
    fees: await estimateFees(client),
  })
  const receipt = await client.waitForTransactionReceipt({
    hash,
    waitUntil: 'decided',
    retries: 300,
    interval: 3000,
  })
  if (receipt.txExecutionResultName === 'FINISHED_WITH_ERROR') {
    throw new Error(`${functionName} reverted (tx ${hash})`)
  }
  return { hash, receipt }
}

export async function read(client, contract, functionName, args = []) {
  return client.readContract({ address: contract, functionName, args })
}
