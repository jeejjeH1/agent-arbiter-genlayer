// End-to-end smoke test against a deployed AgentArbiter.
// Prints every transaction hash, including the settle tx that runs the
// leader/validator adjudication through GenLayer consensus.
// Usage: [NETWORK=studionext|localnet] node scripts/smoke.mjs <contractAddress>
import { makeAccount, makeClient, fund, write, read, explorerTx, NETWORK } from './lib.mjs'

const CONTRACT = process.argv[2]
if (!CONTRACT) {
  console.error('Usage: node scripts/smoke.mjs <contractAddress>')
  process.exit(1)
}

const log = (label, value) => console.log(`\n[${label}]`, value)

async function party() {
  const account = makeAccount()
  const client = makeClient(account)
  if (!(await fund(client, account.address, 100))) {
    throw new Error(`Could not fund ${account.address} on ${NETWORK.name}`)
  }
  return client
}

async function main() {
  log('network', `${NETWORK.name} (chain ${NETWORK.id})`)

  // Three parties: requester (alice), worker (bob), anyone who settles (charlie).
  const alice = await party()
  const bob = await party()
  const charlie = await party()
  log('funded', 'alice, bob, charlie')

  const reward = 10n ** 18n // 1 GEN
  // Unique id so the smoke test can be re-run against the same contract.
  const TASK_ID = `smoke-${Date.now()}`

  // 1. alice creates a task and deposits the reward
  let tx = await write(alice, CONTRACT, 'create_task', [
    TASK_ID,
    'Write a two-sentence summary explaining what GenLayer is.',
    'Exactly two sentences; mentions that GenLayer runs Intelligent Contracts that can use LLMs, validated by consensus.',
    '2099-01-01T00:00:00Z',
  ], reward)
  log('create_task', explorerTx(tx.hash))

  // 2. bob accepts and stakes an equal amount
  tx = await write(bob, CONTRACT, 'accept_task', [TASK_ID], reward)
  log('accept_task', explorerTx(tx.hash))

  // 3. bob submits the work
  tx = await write(bob, CONTRACT, 'submit_work', [
    TASK_ID,
    'GenLayer is a blockchain whose Intelligent Contracts can call LLMs and read the web. Its validators reach agreement on those non-deterministic results through Optimistic Democracy and the Equivalence Principle.',
  ])
  log('submit_work', explorerTx(tx.hash))

  // 4. charlie (anyone) settles — leader + validators adjudicate via consensus
  tx = await write(charlie, CONTRACT, 'settle', [TASK_ID])
  const settleTx = tx.hash
  log('settle', explorerTx(settleTx))

  const task = await read(charlie, CONTRACT, 'get_task', [TASK_ID])
  log('task after settle', task)

  if (task.status !== 'SETTLED') throw new Error('Expected SETTLED')
  if (!['APPROVED', 'REJECTED', 'UNDETERMINED'].includes(task.outcome)) {
    throw new Error('Unexpected outcome: ' + task.outcome)
  }

  console.log('\n=== SMOKE TEST PASSED ===')
  console.log('Final outcome:', task.outcome)
  console.log('Validator reasoning:', task.reasoning)
  console.log('Settle tx (consensus adjudication):', explorerTx(settleTx))
}

main().catch((e) => {
  console.error('Smoke test failed:', e)
  process.exit(1)
})
