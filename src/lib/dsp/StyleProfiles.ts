/**
 * StyleProfiles — predefined reference profiles for different vocal use cases.
 *
 * Each profile defines:
 *  - Reference band energy ratios (target spectral shape)
 *  - Spectral centroid range (brightness target)
 *  - Noise tolerance (how much noise floor is acceptable)
 *  - Target LUFS (loudness normalization target)
 *  - Style-specific processing hints for the Gemini prompt
 */

import type { BandName } from "./frequencyBands";
import type { StyleProfile } from "./types";
import type { StyleTarget } from "@/types/gemini";

// ── Profile definitions ───────────────────────────────────────

const PODCAST: StyleProfile = {
  name: "Podcast Clean",
  referenceBandRatios: {
    rumble: 0.01,
    plosive: 0.04,
    mud: 0.12,
    lowMid: 0.35,
    presence: 0.25,
    harshness: 0.10,
    sibilance: 0.08,
    air: 0.05,
  },
  referenceCentroidRange: [1800, 3200],
  noiseTolerance: 0.3,
  targetLufs: -16,
};

const BROADCAST: StyleProfile = {
  name: "Broadcast",
  referenceBandRatios: {
    rumble: 0.01,
    plosive: 0.05,
    mud: 0.10,
    lowMid: 0.30,
    presence: 0.28,
    harshness: 0.12,
    sibilance: 0.09,
    air: 0.05,
  },
  referenceCentroidRange: [2000, 3500],
  noiseTolerance: 0.2,
  targetLufs: -14,
};

const YOUTUBE: StyleProfile = {
  name: "YouTube",
  referenceBandRatios: {
    rumble: 0.02,
    plosive: 0.05,
    mud: 0.11,
    lowMid: 0.30,
    presence: 0.27,
    harshness: 0.11,
    sibilance: 0.08,
    air: 0.06,
  },
  referenceCentroidRange: [2200, 3800],
  noiseTolerance: 0.4,
  targetLufs: -14,
};

const AUDIOBOOK: StyleProfile = {
  name: "Audiobook",
  referenceBandRatios: {
    rumble: 0.01,
    plosive: 0.03,
    mud: 0.14,
    lowMid: 0.38,
    presence: 0.22,
    harshness: 0.09,
    sibilance: 0.07,
    air: 0.06,
  },
  referenceCentroidRange: [1600, 2800],
  noiseTolerance: 0.15,
  targetLufs: -18,
};

const RAW: StyleProfile = {
  name: "Raw / Natural",
  referenceBandRatios: {
    rumble: 0.03,
    plosive: 0.06,
    mud: 0.15,
    lowMid: 0.32,
    presence: 0.22,
    harshness: 0.10,
    sibilance: 0.07,
    air: 0.05,
  },
  referenceCentroidRange: [1400, 3600],
  noiseTolerance: 0.6,
  targetLufs: -16,
};

// Additional profiles mapping to existing StyleTarget values

const WARM_SMOOTH: StyleProfile = {
  name: "Warm Smooth",
  referenceBandRatios: {
    rumble: 0.02,
    plosive: 0.05,
    mud: 0.16,
    lowMid: 0.36,
    presence: 0.20,
    harshness: 0.08,
    sibilance: 0.07,
    air: 0.06,
  },
  referenceCentroidRange: [1400, 2600],
  noiseTolerance: 0.3,
  targetLufs: -16,
};

const MODERN_BRIGHT: StyleProfile = {
  name: "Modern Bright",
  referenceBandRatios: {
    rumble: 0.01,
    plosive: 0.04,
    mud: 0.08,
    lowMid: 0.28,
    presence: 0.30,
    harshness: 0.13,
    sibilance: 0.09,
    air: 0.07,
  },
  referenceCentroidRange: [2500, 4200],
  noiseTolerance: 0.3,
  targetLufs: -14,
};

const PRESENCE_FORWARD: StyleProfile = {
  name: "Presence Forward",
  referenceBandRatios: {
    rumble: 0.01,
    plosive: 0.04,
    mud: 0.09,
    lowMid: 0.28,
    presence: 0.32,
    harshness: 0.12,
    sibilance: 0.08,
    air: 0.06,
  },
  referenceCentroidRange: [2400, 4000],
  noiseTolerance: 0.25,
  targetLufs: -14,
};

const AGGRESSIVE: StyleProfile = {
  name: "Aggressive",
  referenceBandRatios: {
    rumble: 0.02,
    plosive: 0.06,
    mud: 0.08,
    lowMid: 0.25,
    presence: 0.30,
    harshness: 0.14,
    sibilance: 0.09,
    air: 0.06,
  },
  referenceCentroidRange: [2800, 4500],
  noiseTolerance: 0.4,
  targetLufs: -12,
};

// ── Registry ──────────────────────────────────────────────────

/**
 * Maps StyleTarget enum values to their StyleProfile.
 * All style targets from types/gemini.ts are covered.
 */
export const STYLE_PROFILES: Record<StyleTarget, StyleProfile> = {
  natural: RAW,
  podcast_clean: PODCAST,
  warm_smooth: WARM_SMOOTH,
  modern_bright: MODERN_BRIGHT,
  presence_forward: PRESENCE_FORWARD,
  aggressive: AGGRESSIVE,
};

/**
 * Extended profiles for non-StyleTarget use cases (e.g. future presets).
 */
export const EXTENDED_PROFILES = {
  broadcast: BROADCAST,
  youtube: YOUTUBE,
  audiobook: AUDIOBOOK,
} as const;

/**
 * Get the style profile for a given StyleTarget.
 * Falls back to RAW/natural if unknown.
 */
export function getStyleProfile(target: StyleTarget): StyleProfile {
  return STYLE_PROFILES[target] ?? RAW;
}

/**
 * Build a Gemini prompt section describing the active style profile.
 * This is appended to the system prompt to guide Gemini's decisions.
 */
export function buildStylePromptSection(profile: StyleProfile): string {
  const bandLines = Object.entries(profile.referenceBandRatios)
    .map(([band, ratio]) => `  - ${band}: ${((ratio as number) * 100).toFixed(1)}%`)
    .join("\n");

  return `## Active Style Profile: ${profile.name}

Target spectral balance (band energy ratios):
${bandLines}

Spectral centroid target range: ${profile.referenceCentroidRange[0]}–${profile.referenceCentroidRange[1]} Hz
Target integrated loudness: ${profile.targetLufs} LUFS
Noise tolerance: ${profile.noiseTolerance < 0.25 ? "Low (clean environment expected)" : profile.noiseTolerance < 0.5 ? "Moderate" : "High (noisy source acceptable)"}

Prioritize achieving this spectral shape and loudness target. Adjust EQ, compression, and de-essing parameters to match these reference ratios while respecting safety limits.`;
}
