# Shared product materials and texture packing

Decision memo · 9 November 2026 · based on Andy's supplied shader report, the current Three.js 0.187 source, and the five published pilot products. This is a recommendation; no asset repacking or preset optimization has been applied.

Use existing semantic material slots for distinct parts and clean A/B color blocks. Preserve surface detail with normal, roughness, metalness and optional neutral albedo textures. Use one shared pattern-mask implementation when both palette colors occupy one continuous surface. Changing a palette updates color/uniform values; it must not rebuild materials or change shader defines.

Do not split every checker or marbled patch into a new material slot. Slots can simplify authoring, but extra primitives add draws in each applicable pass. Compatible material objects can share a shader program. Material count, linked-program count, draw calls, texture storage and GPU time are different measurements.

## Candidate packed texture for the simpler route

| Channel | Meaning |
|---|---|
| R | Ambient occlusion; white if absent |
| G | Roughness |
| B | Metalness |
| A | A/B pattern mix; black A, white B, gray blend |

The RGB channels retain the standard ORM convention. Alpha is data, not opacity. All channels must use a compatible UV layout and be loaded without color conversion. Pack only when the required resolutions are compatible: do not inflate a small pattern mask to 4K merely to join a 4K roughness map. A separate smaller mask can be better. Normal remains separate. Optional neutral albedo preserves color-independent grain or tonal detail. Fixed food, glass, metal and other physical regions retain their appropriate materials. No lighting is baked into this map.

This is not the current pilot encoding. The current pilot uses stock colored albedo plus a pigment delta: R coverage, G A/B mix, B tone code. Alpha is currently unused. Some products have nonconstant coverage or tone, which cannot be dropped without appearance evidence. Preserve these pilot files and test the proposed route as a separate generation. Keep an authored default appearance that works in a plain glTF viewer; the runtime mask should add recoloring without making the default product depend on our shader.

The actual field-jacket sample has R=255, variable G, B=0, A=255, and effective coverage/tone=1. Its exported shell binds a normal and roughness texture but no occlusion texture. Its review contact AO is screen-space. The sample demonstrates current mask data, not a newly baked ORM+A texture.

## Changes justified by the shader report

1. **Remove unnecessary shader cache distinctions.** Cache keys should describe real GLSL/feature differences, not product IDs, palette values or role names. The added palette GLSL in 631 matches for body/accent/paint-a; paint-b and inherited shader hooks still need proper distinction. Our 645 adapter already uses structural keys and uniform-only palette updates.
2. **Reuse renderer-scoped environment resources.** 606, 634 and 641 currently generate RoomEnvironment PMREMs in their constructors. Cache equivalent environments per renderer/profile and release them when their owner shuts down. Distinct authored environments can remain distinct.
3. **Keep compatible lighting and shadow configurations stable.** Changing light types/counts, shadow flags, material extensions or output-pass configuration can create legitimate variants. Reuse a small set of compatible surface/lighting profiles while preserving accepted material response. Do not force glass and fabric through one expensive universal shader. Keep a bounded pool of reusable product/material resources; disposing every material between products can force otherwise compatible programs to be linked again.
4. **Warm the configurations actually drawn.** Three's `compileAsync` third argument is a target *scene*, not a render target; omission defaults to the supplied scene. The cited calls already use complete scenes. Match both lighting context and the active render-target/pass state. The screenshot alone does not establish incorrect warmup or the exact reported relink counts.
5. **Audit effect work independently.** Reusing masks will not eliminate AO, bloom, transmission or other passes. Remove confirmed duplicate/unneeded work first and assess any visible quality change separately.

## Acceptance experiment

Compare an existing-part asset and a patterned asset using preserved baseline lighting/camera: current pilot versus slots + packed ORM/A mask. Require matching silhouette, pattern edges, material response and default palette. Measure cold shader links separately from warmed frame time, all-pass draw calls, texture download bytes, decoded texture storage and repeated product/palette swaps. Lossless Zstd reduces download size; this does not reduce the decoded RGBA GPU storage. Palette-only changes should add no links; warmed repeated swaps should reach a stable cache/resource level. These are verification goals, not measured whole-library savings.

Source findings: `631/product-colors.ts:60–91`, `631/stage.ts:252–258,313–314`, `606/stage.ts:99–100`, `634/products.ts:103–104`, `641/inner-products.ts:69–80`, `645/pigment-adapter.ts:234–235,303–311`, `644/native-materials.ts`, and installed Three renderer/program code. Read-only independent audit: `shader-report-audit01/review.md`.

## Provisional conversion schedule

After the pipeline is frozen: allow 15–30 minutes for straightforward existing parts, 30–60 minutes for patterned/detail surfaces, and 1–3 hours for complex optical/packaging exceptions, including preparation and checks. For 105 models, plan 3–5 working days with three workers plus director review. This is a planning estimate, not an extrapolated measured batch duration; recalibrate after ten representative production conversions. Blender rendering remains serialized, while preparation and review can overlap.

Measured successful automatic jobs: air-freshener slice02 56.540 seconds, field-jacket full02 102.873 seconds, headphones slice02 185.570 seconds, bowling-ball full02 235.993 seconds. These times omit prior role authoring, export repairs, additional acceptance views, browser review and investigation. The pilot has included reusable pipeline development, so its calendar duration is not a per-model average.

For a tighter review cycle, a first usable batch in 4–8 hours is a provisional target if material assignments automate cleanly. Use automated format/palette/source checks, default and alternate-palette contact sheets, and close review of flagged exceptions. This reduces review coverage, not asset detail. It does not promise all 105 individually approved within that window. Only reducing manual review will not remove preparation work; the first ten conversions must establish the automation rate and exception mix.

Official API references: [material update and cache contract](https://threejs.org/docs/pages/Material.html), [geometry groups and draw calls](https://threejs.org/docs/pages/BufferGeometry.html), [renderer compilation/statistics](https://threejs.org/docs/pages/WebGLRenderer.html), [PMREM ownership](https://threejs.org/docs/pages/PMREMGenerator.html).
