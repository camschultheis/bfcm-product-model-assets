# River workflow: product color swapping

## Outcome

Prepare editable product assets that change between the five accepted color pairs in Three.js while retaining their original surface detail. Start with Sneakers (`sneaker`) and complete the pilot before expanding. Use Blender 5.2.

Read `color-swap-examples/STOCK_COLOR_CONTRACT_V4.md`, the six example manifests, and `color-swap-examples/shader/pigment-adapter.ts`. These are working references. Bread and cider carry optical qualifications; read those before treating them as appearance benchmarks.

## 1. Establish the source

Read `manifest.json` and the product's `asset.json`. Use the listed native and studio previews. Record input hashes, review status, and palette. A candidate is still awaiting acceptance. Keep supplied sources intact and work in `work/<id>/`.

Inspect geometry, UVs, material slots, normal/roughness/metalness, transparency, fixed graphics, procedural nodes, and animation. List recolorable roles and fixed roles. Flag missing dependencies or ambiguities before altering them. Propose the pilot's material bindings and map layout for review.

## 2. Match the existing color contract

The existing adapter replaces pigment by applying a delta to the stock default-palette albedo. Preserve the stock GLB and its physical material information.

For mapped pigments, the current linear data atlas uses:
- R: recolorable coverage.
- G: blend between pair color A and B.
- B: tone code, reconstructed with explicit tone bias and scale.
- A: optional ambient occlusion only when declared by the contract; never silently reuse opacity.

Uniform roles may use manifest constants instead of textures. Fixed details must have zero recolor coverage. Keep normal, roughness, metallic, opacity, sheen, clearcoat, anisotropy, and transmission independent. Never bake lighting or AO into pigment/albedo to imitate a studio render. Preserve values above one where the authored source requires them.

Use exact immutable source A/B linear values in each binding. The default-to-default swap must preserve stock appearance. Consult the adapter and example manifests for schema, material indices/names, UV channel/matrix, wrap mode, tone decoding, and optional stock gain. Do not invent a different channel layout without agreeing it first.

## 3. Build one complete Sneakers pilot

Deliver a versioned candidate in `deliveries/sneaker/r01/`:
- Editable Blender source and dependency textures.
- Stock GLB retaining physical materials and geometry.
- Pigment maps and any lossless packed runtime versions required by the contract.
- A v4 runtime manifest with hashes, bindings, source colors, color spaces, map metrics, and qualifications.
- Matched stock/default renders and all ten palette states: five accepted pairs, each normal and reversed.
- A short report recording source hashes, methods, checks, and remaining issues.

Palette pairs: cream/blue #F4E9C2/#4F6BE0; lilac/orange #DCCBF5/#F55706; mint/green #CAE5D7/#003E2D; coral/green #FB6B58/#076C01; purple/deep purple #C288F7/#2B0037.

## 4. Verify the result in the consuming viewer

Load the actual exported GLB/maps/manifest using the supplied adapter. Check:
- Default-to-default preserves stock appearance and fixed graphics.
- Every palette state has clean boundaries, continuous UV seams, and useful tone/detail.
- Small views (80,120,180px), hero views, back/edge views, and difficult joins remain readable.
- Normal/roughness response, transparency, thickness, and animation are retained.
- No missing files, invalid bindings, decoding errors, or shader/runtime errors.
- Reopen the delivered Blender file from its delivery folder and confirm dependencies resolve.

Record screenshots and machine-readable validation evidence. Separate a static appearance pass from playback inspection. If animation was not watched, state that explicitly.

## 5. Repair and obtain pilot acceptance

Compare against stock and accepted previews. Identify each mismatch, change only the relevant material/map/binding, and rerun the affected checks. Preserve earlier candidates. Submit the complete pilot and evidence for Cameron's team to approve before repeating the method across the batch. Do not declare success based only on a Blender render or a valid GLB header.

## 6. Expand using the accepted method

Batch: Sneakers, Socks, Lip Gloss, Yarn, Coffee Beans & Ground, Honey, Cakes, False Eyelashes, Bobblehead Figures, Basketballs, Aquariums, Buttons, Trumpets, Candy, Lollipops, Guitar Picks. `texture_split_priority` marks the existing assets. Glitter Flakes needs a source model first.

Work in small batches, preserving one owner per native file. Use the same versioned delivery and evidence format. Flag glass, layered packaging, food optics, or animation that needs special treatment. For assets revised since a successful example (especially Headphones), the example's earlier native is a method reference; do not substitute it for the current catalog model.

Cameron's team handles final reviewer/globe integration and acceptance. Your deliverable must be independently loadable and reviewable, with a clear completed/qualified/blocked status per model.

## Branch and review

Create `river/texture-split-pilot` from this repository's main branch. Commit the complete Sneakers pilot and open a pull request with the source hashes, output paths, manifest validation, visual evidence, and limitations. Request review before merging. After pilot approval, create a separate branch and PR per small batch. Keep main as the reviewed handoff baseline. Use Git LFS for binary model/texture assets and verify LFS upload completion before submitting a PR.
