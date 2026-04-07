/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string
  readonly VITE_STAR_OFFICE_UI_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
