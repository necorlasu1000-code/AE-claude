// Phase 3.3 -- manual tool registry. Phase 5 (30 tools) extends this file
// with one line per tool. C1 decision: explicit > generated. Build-time
// dir scanning isn't viable in bolt-cep ES3 target (no dynamic require).

export { ae_get_active_comp } from "./ae_get_active_comp/handler";
