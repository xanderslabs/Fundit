import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Starts a local Arc mainnet fork with Arc Foundry's anvil, deploys CampaignFactory with
// contracts/script/Deploy.s.sol, funds the test accounts and writes app/.env.e2e.
// Nothing is ever sent anywhere except LOCAL_RPC. The only key used is anvil's public default key 0.

export const LOCAL_RPC = 'http://127.0.0.1:8545'
const ARC_CHAIN_ID = 5042
const FORK_URL = process.env.ARC_FORK_URL || 'https://rpc.mainnet.arc.io'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const CONTRACTS_DIR = join(APP_DIR, '..', 'contracts')
export const ENV_FILE = join(APP_DIR, '.env.e2e')

// Anvil's default mnemonic ("test test ... junk"). These keys are public, so they only ever sign on the fork.
export const ACCOUNTS = {
  deployer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  creator: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  donor: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  treasury: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  other: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
} as const
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// On Arc the native balance (18 decimals) is the USDC balance: the ERC-20 interface at 0x3600..0000 reads it
// with 6 decimals. So anvil_setBalance funds USDC, and 1 USDC is 1e18 wei here.
export const USDC_WEI = 10n ** 18n
const START_BALANCE_USDC = 1000n

// ARC_ANVIL_BIN points at Arc Foundry's anvil. forge is taken from ARC_FORGE_BIN, or found next to anvil.
function binaries(): { anvil: string; forge: string } {
  const anvil = process.env.ARC_ANVIL_BIN || 'arc-anvil'
  let forge = process.env.ARC_FORGE_BIN
  if (!forge) {
    const dir = dirname(anvil)
    forge = ['arc-forge', 'forge'].map((name) => join(dir, name)).find((p) => dir !== '.' && existsSync(p)) ?? 'arc-forge'
  }
  return { anvil, forge }
}

export async function rpc<T = unknown>(method: string, params: unknown[] = [], url = LOCAL_RPC): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = (await res.json()) as { result?: T; error?: { message: string } }
  if (body.error) throw new Error(`${method}: ${body.error.message}`)
  return body.result as T
}

async function localNodeAnswers(): Promise<boolean> {
  try {
    await rpc('eth_chainId')
    return true
  } catch {
    return false
  }
}

async function waitForNode(child: ChildProcess, logFile: string): Promise<void> {
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error(`arc-anvil exited with code ${child.exitCode}. Log: ${logFile}`)
    if (await localNodeAnswers()) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`arc-anvil did not answer on ${LOCAL_RPC} within 60 s. Log: ${logFile}`)
}

export type Fork = {
  forkBlock: bigint
  factory: string
  deployBlock: bigint
  stop(): void
}

export async function startFork(): Promise<Fork> {
  const { anvil, forge } = binaries()
  // Refuse to deploy to a node this run did not start.
  if (await localNodeAnswers()) throw new Error(`Something is already listening on ${LOCAL_RPC}. Stop it first.`)

  // Pin the fork once per run, so every spec sees the same mainnet state.
  const forkBlock = BigInt(await rpc<string>('eth_blockNumber', [], FORK_URL))

  const work = mkdtempSync(join(tmpdir(), 'fundit-e2e-'))
  const logFile = join(work, 'anvil.log')
  const log = openSync(logFile, 'w')
  const child = spawn(
    anvil,
    ['--fork-url', FORK_URL, '--fork-block-number', forkBlock.toString(), '--host', '127.0.0.1', '--port', '8545'],
    { stdio: ['ignore', log, log] },
  )
  const stop = () => {
    child.kill('SIGTERM')
    rmSync(work, { recursive: true, force: true })
  }

  try {
    child.on('error', (err) => console.error(`Could not start ${anvil}: ${err.message}. Set ARC_ANVIL_BIN.`))
    await waitForNode(child, logFile)
    const chainId = Number(await rpc<string>('eth_chainId'))
    if (chainId !== ARC_CHAIN_ID) throw new Error(`Expected chain ${ARC_CHAIN_ID} on the fork, got ${chainId}`)

    // The anvil default accounts are public, so on Arc mainnet most carry an EIP-7702 delegation set by
    // someone else. Clear it on the fork, so they behave as plain accounts.
    for (const address of Object.values(ACCOUNTS)) {
      await rpc('anvil_setCode', [address, '0x'])
      await rpc('anvil_setBalance', [address, `0x${(START_BALANCE_USDC * USDC_WEI).toString(16)}`])
    }

    // Deploy with the real script. Broadcast files go to the temp dir, never to contracts/broadcast.
    try {
      execFileSync(forge, ['script', 'script/Deploy.s.sol', '--rpc-url', LOCAL_RPC, '--broadcast'], {
        cwd: CONTRACTS_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          FOUNDRY_BROADCAST: join(work, 'broadcast'),
          DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY,
          OWNER: ACCOUNTS.deployer,
          TREASURY: ACCOUNTS.treasury,
          DONATION_FEE_BPS: '100',
          WITHDRAW_FEE_BPS: '100',
          EURC_PAYOUT_DOMAINS: '',
        },
      })
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer; message: string }
      throw new Error(`Deploy.s.sol failed (${forge}): ${e.message}\n${e.stdout ?? ''}\n${e.stderr ?? ''}`)
    }
    const run = JSON.parse(readFileSync(join(work, 'broadcast', 'Deploy.s.sol', String(ARC_CHAIN_ID), 'run-latest.json'), 'utf8')) as {
      returns: { factory: { value: string } }
      receipts: { contractAddress: string | null; blockNumber: string }[]
    }
    const factory = run.returns.factory.value
    const receipt = run.receipts.find((r) => r.contractAddress?.toLowerCase() === factory.toLowerCase())
    if (!receipt) throw new Error('Deploy receipt for the factory not found')
    const deployBlock = BigInt(receipt.blockNumber)

    // Read by `vite build --mode e2e`. All values are public. The Reown id is a dummy: e2e mode has no AppKit.
    writeFileSync(
      ENV_FILE,
      [
        '# Written by e2e/fork.ts for one local e2e run. Do not commit.',
        `VITE_FACTORY_ADDRESS=${factory}`,
        `VITE_FACTORY_DEPLOY_BLOCK=${deployBlock}`,
        'VITE_REOWN_PROJECT_ID=e2e-dummy',
        `VITE_ARC_RPC_URL=${LOCAL_RPC}`,
        '',
      ].join('\n'),
    )
    return { forkBlock, factory, deployBlock, stop }
  } catch (err) {
    stop()
    throw err
  }
}
