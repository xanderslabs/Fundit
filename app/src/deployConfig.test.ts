import { zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { loadConfig } from './deployConfig'

const FACTORY = '0x1111111111111111111111111111111111111111'
const prodEnv = { PROD: true, VITE_FACTORY_ADDRESS: FACTORY, VITE_FACTORY_DEPLOY_BLOCK: '26280000', VITE_REOWN_PROJECT_ID: 'abc123' }

// A production bundle pointing at 0x0, or without a Reown project id, deploys a site
// where nothing loads and no wallet connects. The build must fail instead.
describe('loadConfig', () => {
  it('reads a complete production env', () => {
    expect(loadConfig(prodEnv)).toEqual({ factoryAddress: FACTORY, factoryDeployBlock: 26280000n, reownProjectId: 'abc123' })
  })

  it('throws when the factory address is set but the deploy block is missing, in any mode', () => {
    expect(() => loadConfig({ PROD: false, VITE_FACTORY_ADDRESS: FACTORY })).toThrow(/VITE_FACTORY_DEPLOY_BLOCK/)
    expect(() => loadConfig({ ...prodEnv, VITE_FACTORY_DEPLOY_BLOCK: '' })).toThrow(/VITE_FACTORY_DEPLOY_BLOCK/)
  })

  it('throws in production when the factory address is missing', () => {
    expect(() => loadConfig({ ...prodEnv, VITE_FACTORY_ADDRESS: undefined })).toThrow(/VITE_FACTORY_ADDRESS/)
  })

  it('throws in production when the factory deploy block is missing', () => {
    expect(() => loadConfig({ ...prodEnv, VITE_FACTORY_ADDRESS: undefined, VITE_FACTORY_DEPLOY_BLOCK: undefined })).toThrow(/VITE_FACTORY/)
  })

  it('throws in production when the Reown project id is empty', () => {
    expect(() => loadConfig({ ...prodEnv, VITE_REOWN_PROJECT_ID: '' })).toThrow(/VITE_REOWN_PROJECT_ID/)
  })

  it('uses zero defaults in dev and test only when both factory vars are unset', () => {
    expect(loadConfig({ PROD: false })).toEqual({ factoryAddress: zeroAddress, factoryDeployBlock: 0n, reownProjectId: '' })
  })

  it('throws on a deploy block without an address, and on malformed values', () => {
    expect(() => loadConfig({ PROD: false, VITE_FACTORY_DEPLOY_BLOCK: '1' })).toThrow(/VITE_FACTORY_ADDRESS/)
    expect(() => loadConfig({ PROD: false, VITE_FACTORY_ADDRESS: '0x123', VITE_FACTORY_DEPLOY_BLOCK: '1' })).toThrow(/not a valid address/)
    expect(() => loadConfig({ PROD: false, VITE_FACTORY_ADDRESS: FACTORY, VITE_FACTORY_DEPLOY_BLOCK: '1e6' })).toThrow(/block number/)
  })
})
