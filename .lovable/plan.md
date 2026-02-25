

## Plan: Add Issue Heatmap Bar to AnalysisReport

### What It Is

A compact, horizontal frequency spectrum bar (0-20kHz) inside the AnalysisReport, where colored segments visually indicate severity of each issue category at its approximate frequency range. Think of it like a color-coded EQ display showing where problems live.

### Design

```text
0Hz                                              20kHz
├──── Mud ────┤── Box ──┤─ Nasal ─┤── Harsh ──┤─ Sibilance ─┤
   200-500Hz   500-1kHz  800-1.5k   2-5kHz      5-10kHz
   ██████████  ████████  ████████   ██████████  █████████████
   (green)     (yellow)  (green)    (red)       (orange)
```

Each band is colored by severity: green (low), yellow (moderate), red (high). The bar uses a logarithmic frequency scale so the bands are visually proportional to how engineers think about the spectrum.

### Data Source

The current `LayerOneAnalysis` already has `globalHarshness` (0-100) and `globalSibilance` (0-100). For mud, boxiness, and nasal scores, these don't exist yet in the type. Two options:

**Option chosen**: Derive approximate scores from the existing band energy ratios (`energyRatio2kTo5k`, `energyRatio5kTo9k`, `sibilanceBand5kTo10k`) and add simple heuristic scoring for the lower bands directly in the heatmap component. The heatmap will accept the `LayerOneAnalysis` object and compute display-only severity for bands that don't have explicit scores yet. This keeps the component self-contained and avoids modifying types or analysis code for a purely visual addition.

For mud and boxiness, since we don't have those metrics yet, the heatmap will show them as "N/A" (gray) with a tooltip indicating expanded analysis is needed. Harshness and sibilance will use real data.

### Implementation

**Modified file**: `src/components/AnalysisReport.tsx`

Add a new `IssueHeatmap` internal component that:

1. Defines 5 frequency bands with label, frequency range, and a log-scaled width
2. Maps each band to a severity score from the analysis data:
   - **Mud (200-500Hz)**: gray/unavailable for now (no metric exists)
   - **Boxiness (500-1kHz)**: gray/unavailable for now
   - **Nasal (800-1.5kHz)**: gray/unavailable for now
   - **Harshness (2-5kHz)**: uses `analysis.globalHarshness`
   - **Sibilance (5-10kHz)**: uses `analysis.globalSibilance`
3. Colors each band segment: green (`bg-primary`) for score < 35, yellow (`bg-accent`) for 35-60, red (`bg-destructive`) for > 60, gray (`bg-muted`) for unavailable
4. Shows frequency labels below, issue name and score on hover via title attribute
5. Renders inside the existing "Measured Findings" section, between the ScoreBars and the metric grid

The component is purely presentational, no new dependencies, no type changes, no new files.

### Visual Details

- Full width bar, height ~20px, rounded corners
- Each band is a `div` with `flex` width proportional to its log-scaled frequency span
- Small frequency tick labels below: 200, 500, 1k, 2k, 5k, 10k, 20k
- A small legend row: colored dots with labels (Low / Moderate / High / N/A)
- Title: "Issue Heatmap" with the BarChart3 icon, using the existing `Section` wrapper

