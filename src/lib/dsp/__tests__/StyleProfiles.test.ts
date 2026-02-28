import { describe, it, expect } from "vitest";
import {
  STYLE_PROFILES,
  EXTENDED_PROFILES,
  getStyleProfile,
  buildStylePromptSection,
} from "../StyleProfiles";
import type { StyleTarget } from "@/types/gemini";

const ALL_TARGETS: StyleTarget[] = [
  "natural",
  "podcast_clean",
  "warm_smooth",
  "modern_bright",
  "presence_forward",
  "aggressive",
];

describe("StyleProfiles", () => {
  it("covers every StyleTarget", () => {
    for (const t of ALL_TARGETS) {
      expect(STYLE_PROFILES[t]).toBeDefined();
      expect(STYLE_PROFILES[t].name).toBeTruthy();
    }
  });

  it("band ratios sum to ~1.0 for each profile", () => {
    const allProfiles = [
      ...Object.values(STYLE_PROFILES),
      ...Object.values(EXTENDED_PROFILES),
    ];
    for (const p of allProfiles) {
      const sum = Object.values(p.referenceBandRatios).reduce(
        (s, v) => s + (v ?? 0),
        0
      );
      expect(sum).toBeGreaterThan(0.95);
      expect(sum).toBeLessThan(1.05);
    }
  });

  it("targetLufs is within broadcast standards", () => {
    for (const p of Object.values(STYLE_PROFILES)) {
      expect(p.targetLufs).toBeGreaterThanOrEqual(-24);
      expect(p.targetLufs).toBeLessThanOrEqual(-10);
    }
  });

  it("centroid ranges are valid [min, max]", () => {
    for (const p of Object.values(STYLE_PROFILES)) {
      const [lo, hi] = p.referenceCentroidRange;
      expect(lo).toBeLessThan(hi);
      expect(lo).toBeGreaterThan(500);
      expect(hi).toBeLessThan(10000);
    }
  });

  it("getStyleProfile returns RAW for unknown target", () => {
    const p = getStyleProfile("nonexistent" as StyleTarget);
    expect(p.name).toBe("Raw / Natural");
  });

  it("getStyleProfile returns correct profile for known target", () => {
    expect(getStyleProfile("podcast_clean").name).toBe("Podcast Clean");
    expect(getStyleProfile("aggressive").name).toBe("Aggressive");
  });

  it("buildStylePromptSection contains profile name and LUFS target", () => {
    const p = STYLE_PROFILES.podcast_clean;
    const section = buildStylePromptSection(p);
    expect(section).toContain("Podcast Clean");
    expect(section).toContain("-16 LUFS");
    expect(section).toContain("spectral balance");
  });

  it("noiseTolerance is between 0 and 1", () => {
    for (const p of Object.values(STYLE_PROFILES)) {
      expect(p.noiseTolerance).toBeGreaterThanOrEqual(0);
      expect(p.noiseTolerance).toBeLessThanOrEqual(1);
    }
  });
});
