// Phase 5.2.2 -- zod schema for ae_create_comp (write, comp lane 2/3,
// D4 destructive flag + undoGroup wiring reference example).
//
// Parameter order mirrors ItemCollection.addComp per types-for-adobe AE
// 22.0 (line 1367+): addComp(name, width, height, pixelAspect, duration,
// frameRate): CompItem. Our zod input keeps the same field names but
// orders them by user-facing priority -- claude usually says
// "make a comp called X, 1920x1080, 30fps, 5 seconds" -- so the schema
// surfaces name/width/height/frameRate/duration before pixelAspect.
// pixelAspect + bgColor are optional (most prompts don't specify them).
//
// Limits:
//   width/height -- max 30000 per AE UI (Composition Settings panel).
//   frameRate    -- max 999 (AE accepts arbitrary positive but practical
//                   ceiling is project-dependent; 999 covers slow-mo
//                   sources without inviting absurd values).
//   duration     -- positive number of seconds; no upper cap (could be
//                   hours for time-lapse sources).
//   bgColor      -- ThreeDColorValue [r, g, b] each 0-1 normalized
//                   (NOT 0-255). claude must remap if asked in hex/255.
//   pixelAspect  -- positive number, default 1.0 (square pixels). Anamorphic
//                   sources may need 2.0 or 1.21.

import { z } from "zod";

export const aeCreateCompInputSchema = z.object({
  /** Composition name (Project panel label). Empty string rejected. */
  name: z.string().min(1),
  /** Width in pixels. Production AE Composition Settings caps at 30000. */
  width: z.number().int().positive().max(30000),
  /** Height in pixels. Same cap as width. */
  height: z.number().int().positive().max(30000),
  /** Frames per second. Production AE accepts any positive number;
   *  capping at 999 to filter accidental garbage values. */
  frameRate: z.number().positive().max(999),
  /** Duration in SECONDS (not frames). Total comp length. */
  duration: z.number().positive(),
  /** Background color as ThreeDColorValue: [r, g, b] each in 0-1 range
   *  (NOT 0-255 nor hex). When omitted, AE uses the project default
   *  (typically black). */
  bgColor: z
    .tuple([
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
    ])
    .optional(),
  /** Pixel aspect ratio. Default 1.0 (square pixels). 2.0 is widescreen
   *  anamorphic; 1.21 is DV anamorphic. */
  pixelAspect: z.number().positive().optional(),
});
export type AeCreateCompInput = z.infer<typeof aeCreateCompInputSchema>;

export const aeCreateCompOutputSchema = z.object({
  /** CompItem.id (assigned by AE on creation). Stable across the session;
   *  subsequent tool calls (ae_get_layers, ae_set_active_comp, etc.) use
   *  this id to reference the new comp. */
  id: z.number().int().positive(),
  /** Echo of the name set on creation. */
  name: z.string(),
  /** Echo of width. */
  width: z.number().int().positive(),
  /** Echo of height. */
  height: z.number().int().positive(),
  /** Echo of frameRate. */
  frameRate: z.number().positive(),
  /** Echo of duration (seconds). */
  duration: z.number().positive(),
});
export type AeCreateCompOutput = z.infer<typeof aeCreateCompOutputSchema>;
