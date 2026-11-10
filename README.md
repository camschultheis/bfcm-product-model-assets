# Product model assets

Latest product-library snapshot, 10 November 2026, through Pass25 supplied lollipop.

134 editable native models: 132 active and 2 archived. `manifest.json` identifies exact versions, review status, palette, preview images, extracted textures, and any dependency qualifications. Candidate status remains candidate; inclusion does not imply approval or live GLB readiness.

## Open the library

Install Git LFS before cloning, then run `git lfs pull`. Use Blender 5.2. Models are in `models/<id>/`; archived models are in `archived/<id>/`. Each folder contains an `asset.json`, native master, studio previews, and textures where used. Procedural materials remain editable in the native file. Existing GLBs are included only where published for this exact catalog version.

## River texture pass

Read `RIVER_TEXTURE_SPLIT.md`. Start with Sneakers; confirm mask layout before continuing. `texture_split_priority` marks the requested existing models. Glitter Flakes still needs a model and is not fabricated here.

Preserve delivered sources. Put work in `work/<id>/` and deliver versioned candidates in `deliveries/<id>/<revision>/`. Include masks, editable sources, channel/color-space manifest, and matched color previews.

## Verification

`package-report.json` records dependency inspection. `verification.json` records file hashes and representative Blender reopen checks. Six successful color-swap example packages and their shader code are included in `color-swap-examples/`. Their source revisions are recorded separately from the latest library models. Bread and cider retain optical qualifications.
