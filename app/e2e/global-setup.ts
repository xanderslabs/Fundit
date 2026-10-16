import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startFork } from './fork'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
export const PREVIEW_PORT = 4173
export const OUT_DIR = 'dist-e2e'

async function waitForPreview(child: ChildProcess): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`vite preview exited with code ${child.exitCode}`)
    try {
      if ((await fetch(`http://127.0.0.1:${PREVIEW_PORT}/`)).ok) return
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('vite preview did not start within 30 s')
}

// The factory address is only known after the deploy, so the e2e bundle is built here, after the fork is
// up, and served by vite preview. Playwright's webServer starts before globalSetup, so it is not used.
export default async function globalSetup() {
  const fork = await startFork()
  let preview: ChildProcess | null = null
  const teardown = () => {
    preview?.kill('SIGTERM')
    fork.stop()
  }
  try {
    process.env.E2E_FACTORY = fork.factory
    process.env.E2E_FORK_BLOCK = fork.forkBlock.toString()
    console.log(`e2e: Arc fork at block ${fork.forkBlock}, factory ${fork.factory} (block ${fork.deployBlock})`)

    execFileSync('npx', ['vite', 'build', '--mode', 'e2e', '--outDir', OUT_DIR, '--emptyOutDir'], { cwd: APP_DIR, stdio: 'inherit' })
    preview = spawn(
      'npx',
      ['vite', 'preview', '--mode', 'e2e', '--outDir', OUT_DIR, '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort'],
      { cwd: APP_DIR, stdio: 'ignore' },
    )
    await waitForPreview(preview)
  } catch (err) {
    teardown()
    throw err
  }
  return teardown
}
