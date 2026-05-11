// Phase 3.3 -- manual tool registry. Phase 5 (30 tools) extends this file
// with one line per tool. C1 decision: explicit > generated. Build-time
// dir scanning isn't viable in bolt-cep ES3 target (no dynamic require).
//
// Phase 5.1.1 (D-M, option A) -- tools collocated under sidecar/src/tools/<ae>/impl.ts,
// reachable via @aeTools alias (vite.es.config.ts rollup config). 5.1.0 dormant
// alias becomes active at this line on first encounter.
//
// Phase 5.1.4 — ae_list_comps (MVP 1/5, comp lane). Same alias path; one
// named export + one entry in tools sub-namespace per tool.

export { ae_get_active_comp } from "@aeTools/ae_get_active_comp/impl";
export { ae_list_comps } from "@aeTools/ae_list_comps/impl";
export { ae_get_layers } from "@aeTools/ae_get_layers/impl";
export { ae_list_effects } from "@aeTools/ae_list_effects/impl";
export { ae_get_expression } from "@aeTools/ae_get_expression/impl";
export { ae_get_keyframes } from "@aeTools/ae_get_keyframes/impl";
export { ae_get_project_info } from "@aeTools/ae_get_project_info/impl";
export { ae_create_comp } from "@aeTools/ae_create_comp/impl";
export { ae_set_active_comp } from "@aeTools/ae_set_active_comp/impl";
