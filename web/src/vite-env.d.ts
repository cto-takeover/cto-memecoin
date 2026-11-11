/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_NEAR_RPC_URL?: string;
  readonly VITE_DEMO_CONTRACT_ID?: string;
  readonly VITE_MAIN_CONTRACT_ID?: string;
  readonly VITE_ANI_ACCOUNT_ID?: string;
  readonly VITE_BUDI_ACCOUNT_ID?: string;
  /** "0" turns off explorer lookups (local sandbox). */
  readonly VITE_EXPLORER?: string;
}
