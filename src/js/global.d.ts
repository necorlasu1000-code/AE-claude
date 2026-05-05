import { cep_node, cep, __adobe_cep__ } from "./lib/cep-types";

declare module "*.png";
declare module "*.gif";
declare module "*.jpg";
declare module "*.svg";

declare global {
  interface Window {
    cep_node: cep_node;
    cep: cep;
    __adobe_cep__: __adobe_cep__;
  }
  /**
   * Injected by vite.config.ts `define` at build time. Absolute path
   * to the sidecar/ folder in the repo. Production override via the
   * AE_CLAUDE_SIDECAR_ROOT env var (panel runtime cep_node.process.env).
   */
  const __DEV_SIDECAR_ROOT__: string;
}
