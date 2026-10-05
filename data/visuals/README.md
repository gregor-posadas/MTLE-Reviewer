# Visual explainers: how to write one

Each subject has a file here (`CC.json`, `MP.json`, `CM.json`, `HE.json`, `BB.json`, `HL.json`) with a `visuals` list. The site shows them in three places:

- the **Visual explainers** library (Practice > Visual explainers);
- before the questions in **Learn a topic**, when a visual is tagged with that topic;
- as **See it as a diagram** under a question's explanation, when the question's text contains one of the visual's keywords.

She taps **Next** and **Back** through the steps. Each step changes what the diagram shows or highlights, and has a caption of 1 to 3 sentences.

## Two kinds

### 1. Drawn diagrams (`"type": "svg"`)

```json
{
  "id": "cc-westgard",
  "type": "svg",
  "subject": "CC",
  "tos": ["CC-B.1"],
  "title": "Westgard rules on a Levey–Jennings chart",
  "keywords": ["westgard", "levey-jennings", "1-3s"],
  "viewBox": "0 0 360 300",
  "svg": "<g>…</g>",
  "steps": [
    { "caption": "…", "show": ["points-a"], "hl": [] },
    { "caption": "…", "show": ["points-b", "label-b"], "hl": ["label-b"] }
  ],
  "alt": "A plain-text description of the whole diagram for screen readers.",
  "source": "Original diagram. Facts per Bishop's Clinical Chemistry 9e, quality control chapter."
}
```

- **`svg`** is the inside of an `<svg>` element (no `<svg>` wrapper). The site adds the wrapper with your `viewBox`.
- **Steps work by keys.** Put `data-k="some-key"` on a `<g>` (or any element).
  - An element **without** `data-k` is always visible (the base drawing).
  - A key that appears in **any** step's `show` list is step-controlled: it is visible only in the steps whose `show` names it. `show` is not cumulative, so list every such key the step needs.
  - A key that never appears in a `show` list is always visible, and can still be highlighted with `hl`.
  - Keys in a step's `hl` list are highlighted: thicker outline and bold text. Use it to point at the part the caption is about.
  - Any key used in `show` or `hl` must exist in the SVG.
- **Size.** The `viewBox` is **360 wide**, and up to 640 tall. It's drawn about 340 px wide on a phone, so text must be **at least 12** units (`v-small`). Labels are 14.
- **No colours in the SVG.** Use these classes, so light and dark mode both work and the colours stay colour-blind safe:

| Class | What it does |
|---|---|
| `v-box` | Box: surface fill, ink outline |
| `v-line` | Ink line, no fill. Add `v-arrow` for an arrowhead at the end |
| `v-thin` | Thin grey line (grids, guides) |
| `v-dash`, `v-dot` | Dashed or dotted line (combine with `v-line` or `v-thin`) |
| `v-draw` | The line draws itself in when its step appears (good for pathways and flows; don't combine with `v-dash`) |
| `v-text` | Text in ink, 14. Add `v-small` (12), `v-b` (bold), `v-muted` (grey), `v-mid` (centred), `v-end` (right-aligned) |
| `v-tint-1` … `v-tint-5` | Light fill for boxes that hold text (1 blue, 2 orange, 3 light blue, 4 gold, 5 maroon). Text on them stays ink |
| `v-fill-1` … `v-fill-5` | Solid fill for small marks (dots, bars, bands). Never put text on a solid fill |
| `v-stroke-1` … `v-stroke-5` | Coloured outline or line |
| `v-fill-ink` | Solid ink (black in light mode, white in dark) |
| `v-hatch` | Hatched fill: the second encoding when two fills must be told apart without colour |
| `v-real` | Real-world colour that is itself the content (tube caps, stain colours): set `fill` inline, and always add a text label |

- **Colour never carries meaning alone.** Every coloured thing also has a label, a shape or a pattern.
- **Only shapes and text.** No `<script>`, no `on…=` attributes, no links, no `<image>`, no `<foreignObject>`. The site strips them anyway.

### 2. Image walkthroughs (`"type": "image"`)

For a public-domain or openly licensed figure, such as a CDC DPDx life cycle:

```json
{
  "id": "mp-lc-ascaris",
  "type": "image",
  "subject": "MP",
  "tos": ["MP-H.1"],
  "title": "Ascaris lumbricoides life cycle",
  "keywords": ["ascaris"],
  "src": "https://www.cdc.gov/dpdx/ascariasis/images/…",
  "credit": "CDC DPDx",
  "license": "Public domain",
  "page": "https://www.cdc.gov/dpdx/ascariasis/index.html",
  "steps": [ { "caption": "Stage 1 on the figure: …" } ],
  "alt": "…",
  "source": "CDC DPDx life cycle figure."
}
```

The figure stays the same in every step, and each caption walks through its numbered stages.

## Content rules

- **Original drawings only.** Don't trace or copy a textbook figure. Facts are fine.
- **Accuracy first.** Use only standard facts, the same references as the questions.
- **3 to 7 steps.** The last step usually shows the whole picture with a one-line takeaway.
- **Keywords** are lowercase phrases specific enough to point at the right questions, such as "order of draw" or "aptt". Not "blood" or "test".
