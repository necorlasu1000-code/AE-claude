// Phase 3.3 -- manual tool registry. Phase 5 (30 tools) extends this file
// with one line per tool. C1 decision: explicit > generated. Build-time
// dir scanning isn't viable in bolt-cep ES3 target (no dynamic require).
//
// Phase 5.1.1 (D-M, option A) -- tools collocated under sidecar/src/tools/<ae>/impl.ts,
// reachable via @aeTools alias (vite.es.config.ts rollup config). 5.1.0 dormant
// alias becomes active at this line on first encounter.

export { ae_get_active_comp } from "@aeTools/ae_get_active_comp/impl";
