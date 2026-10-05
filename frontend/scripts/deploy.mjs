// Deploys the AgentArbiter contract.
// Usage:
//   node scripts/deploy.mjs                       # Studio Next (chain 61997)
//   NETWORK=localnet node scripts/deploy.mjs      # local glsim
//   PRIVATE_KEY=0x... node scripts/deploy.mjs     # reuse a funded account
import { readFileSync } from 'node:fs'
import { makeAccount, makeClient, fund, explorerTx, NETWORK, NETWORK_ID } from './lib.mjs'

const CONTRACT_PATH = new URL('../../contracts/agent_arbiter.py', import.meta.url)

async function main() {
  const account = makeAccount(process.env.PRIVATE_KEY)
  const client = makeClient(account)

  console.log(`Network: ${NETWORK.name} (chain ${NETWORK.id}) ${NETWORK.rpcUrls.default.http[0]}`)
  console.log('Deployer address:', account.address)
  console.log('Funded:', await fund(client, account.address, 1000))

  const code = readFileSync(CONTRACT_PATH, 'utf8')
  console.log('Deploying AgentArbiter…')
  const txHash = await client.deployContract({
    code,
    args: [],
    consensusMaxRotations: 3,
  })
  console.log('Deploy tx:', txHash)

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: 'FINALIZED',
  })

  const contractAddress =
    receipt.recipient ??
    receipt.to_address ??
    receipt.data?.contract_address ??
    receipt.txDataDecoded?.contractAddress

  if (!contractAddress) {
    console.error(
      'Could not resolve contract address from receipt:',
      JSON.stringify(receipt, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
    )
    process.exit(1)
  }

  console.log('\n=== AgentArbiter deployed ===')
  console.log('Address:', contractAddress)
  console.log('Tx:', explorerTx(txHash))
  console.log('\nSet this in frontend/.env.local:')
  console.log(`VITE_NETWORK=${NETWORK_ID}`)
  console.log(`VITE_CONTRACT_ADDRESS=${contractAddress}`)
}

main().catch((e) => {
  console.error('Deploy failed:', e)
  process.exit(1)
})
