# Stock color contract v4

Pilot GLBs must contain their source/default palette in ordinary PBR base color.
The base-color bake captures color only: no lights, AO, or lightmaps. A runtime
failure or a disabled live-color toggle therefore retains usable stock appearance.

Each pigment binding records immutable `default_a_linear` and
`default_b_linear`, taken from source material roles before tone. The active UI
pair never defines the source defaults. Linear data channels remain coverage C,
A/B mix M, and encoded tone T, with explicit scale/bias.

Given source/default pigment P0 and new pigment P1, replace only its contribution:

```text
stock = (1-C)*residual + C*tone*P0
output = stock + C*tone*(P1-P0)
       = (1-C)*residual + C*tone*P1
```

The previous `mix(stock, newPigment, C)` applied coverage twice and retained old
color at partial edges. v3 is preserved under `adapter-v3-preserved/`.

The v4 manifest requires `stock_base_color: "default-palette"` and explicit
source A/B for each pigment binding. Stock alpha, ORM.R AO, roughness, metallic,
normal, transmission, sheen, coat, and anisotropy remain in ordinary PBR inputs.
One shared adapter handles all products; shader keys exclude palette state.

Chrome / Three 187 GPU fixtures passed default stock pixel identity and all ten
pair/reversal states against independently constructed ordinary PBR references.
Eight data samples include partial coverage, mixed A/B, and tone from 0.5 to 1.7.
Maximum measured channel difference was zero. Four UV channels, fixed material
colors, clone uniform isolation, and palette program stability also passed.

These are synthetic plane checks. Actual exported products still require native
appearance, map/UV/mip, rotation, and package/load comparisons before acceptance.


2026-11-09 signal revision: uniform bindings can carry `constant: {coverage,
mix, tone}` with no pigment texture or pigment UV. This is exclusive with mapped
fields. Mapped bindings may carry `channel_constants` for any verified uniform
C/M/tone; overrides operate on decoded tone, not its stored byte. Both paths
retain immutable source A/B and use the same delta equation.

A fully covered pattern uses C=1 and its constant tone, and a pattern-only M
map. For distant consistency, source albedo and pigment M must be authored from
the same signal field and preserve the measured mean of the actual pattern
surface. Empty atlas space and other materials must not contaminate that mean.
Authored-byte equality is insufficient evidence of semantic mip correctness.

The pilot stock/live checkbox changes `bfcmPigmentEnabled` between zero and one
on the installed handles. It does not remove/reinstall hooks. A separate actual
rollback releases the material's GPU program cache before restoring hooks:
Three 187 stores one uniform table per material, so returning to a cached shader
program after a hook change otherwise retains the wrong table. Materials and
source textures remain reusable. GTAO/contact shading was not the cause.

Chrome fixtures passed all ten states for texture-free constant signals and
mapped channel overrides against ordinary PBR, with maximum channel error zero.
Stock/live switching and rollback/reinstall are checked separately.
