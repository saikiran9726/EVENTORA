/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_YOUPI_CHECKOUT_URL?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
