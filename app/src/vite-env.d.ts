/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REOWN_PROJECT_ID?: string
  readonly VITE_CIRCLE_CLIENT_KEY?: string
  readonly VITE_FACTORY_ADDRESS?: string
  readonly VITE_FACTORY_DEPLOY_BLOCK?: string
  readonly VITE_ARC_RPC_URL?: string
  readonly VITE_MAINNET_RPC_URL?: string
  readonly VITE_CROSSCHAIN?: string
  readonly VITE_BETA?: string
  readonly VITE_EMAIL_SIGNIN?: string
  readonly VITE_CIRCLE_UCW_APP_ID?: string
  readonly VITE_TURNSTILE_SITE_KEY?: string
  readonly VITE_ARC_NETWORK?: string
  readonly VITE_ALLOW_TESTNET_BUILD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Node's process and Buffer for the browser, set as globals only before Circle's SDK loads (lib/circleEmail.ts).
declare module 'vite-plugin-node-polyfills/shims/process' {
  const process: object
  export default process
}
declare module 'vite-plugin-node-polyfills/shims/buffer' {
  const Buffer: object
  export default Buffer
}
