// Phase 5.2.1 -- zod schema for ae_get_project_info (read-only, 컴프 lane 1/3).
//
// Project metadata snapshot. No active comp dependency -- works on any
// project state including empty/unsaved. Project class fields per
// types-for-adobe AE 22.0 (line 1712+); hostVersion sourced from app.version.
//
// Field selection rationale (CLI 자율 결정 2026-05-10):
// Included 6 fields prioritized for claude's first-attempt accuracy --
//   file (saved-state + name for ID), numItems (project size signal),
//   bitsPerChannel (color depth, affects effect/output decisions),
//   expressionEngine (extendscript vs javascript-1.0, claude expression
//   tools must match), displayStartFrame (timeline start offset),
//   hostVersion (compatibility gate before tool selection).
// Excluded: linearBlending / workingGamma / gpuAccelType / framesCountType
// / feetFramesFilmType / footageTimecodeDisplayStartType / timeDisplayType
// / xmpPacket / workingSpace / linearizeWorkingSpace / transparencyGridThumbnails
//   -- specialized, low first-attempt utility; xmpPacket large-string noisy.
// selection / rootFolder / items / renderQueue / activeItem are out of scope
// (covered by ae_list_comps / ae_get_active_comp / future tools).

import { z } from "zod";

export const aeGetProjectInfoInputSchema = z.object({});
export type AeGetProjectInfoInput = z.infer<typeof aeGetProjectInfoInputSchema>;

export const aeProjectFileSchema = z.object({
  /** Absolute path via ExtendScript File.fsName (Windows backslash style). */
  path: z.string(),
  /** Basename via ExtendScript File.name (e.g. "MyProject.aep"). */
  name: z.string(),
});
export type AeProjectFile = z.infer<typeof aeProjectFileSchema>;

export const aeGetProjectInfoOutputSchema = z.object({
  /** Project file when saved; null when project is unsaved/new. */
  file: aeProjectFileSchema.nullable(),
  /** Total item count in the Project panel (numItems). */
  numItems: z.number().int().nonnegative(),
  /** Color depth bits per channel: 8 / 16 / 32. */
  bitsPerChannel: z.number().int(),
  /** Expression engine -- "extendscript" (legacy) or "javascript-1.0" (modern).
   *  Claude expression-writing tools (ae_set_expression Phase 5.6) must
   *  match this engine. */
  expressionEngine: z.enum(["extendscript", "javascript-1.0"]),
  /** Frame numbering display start (Project Settings > Display Style). */
  displayStartFrame: z.number().int(),
  /** AE host application version (app.version, e.g. "22.0.0"). Sourced
   *  from app.version, not Project class -- included as project-meta for
   *  compatibility checks before further tool calls. */
  hostVersion: z.string(),
});
export type AeGetProjectInfoOutput = z.infer<typeof aeGetProjectInfoOutputSchema>;
