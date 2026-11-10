/**
 * BFCM PigmentPBR adapter v4 — stock default-palette delta replacement.
 * v3 is preserved in output/dynamic-product-color-plan/adapter-v3-preserved.
 * Only dependency: 'three' (0.187.x). Actual product fidelity requires exported-product QA.
 *
 * Pigment data (linear, NoColorSpace; one atlas per product allowed, shared by explicit bindings):
 *   R = coverage, G = A↔B mix, B = tone code; tone = tone_bias + tone_scale*B (measured, may exceed 1)
 *   albedo = stockDiffuse*stock_linear_gain + R*tone*(mix(targetA,targetB,G)-mix(sourceA,sourceB,G))
 * Optional stock_linear_gain restores normalized stock albedo without clipping authored values above one.
 * Source A/B are explicit immutable binding values. Default→default preserves stock exactly,
 * including partial-coverage edges and fixed residual colors. No albedo lightmap or AO baked in.
 * Optional alpha AO affects indirect PBR lighting only. Stock opacity, roughness/metalness,
 * normal, sheen, clearcoat, anisotropy and transmission remain independent.
 * Install AFTER adaptNativeMaterial (it may replace the material object).
 */
import * as THREE from 'three';
import { aoAlias, checkAO, installAO, patchAO, type AOHandle, type BakedAO } from './packed-ao';

export const ADAPTER_VERSION = 'bfcm-pigment-v4-signals3-stock-gain1';
export const MANIFEST_SCHEMA = 'bfcm-pigment-manifest/v4';

// ------------------------------------------------------------------ palette
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
export const PAIRS: Readonly<Record<string, readonly [string, string]>> = Object.freeze(Object.assign(Object.create(null), {
  cream_blue: ['#F4E9C2', '#4F6BE0'],
  lilac_orange: ['#DCCBF5', '#F55706'],
  mint_green: ['#CAE5D7', '#003E2D'],
  coral_green: ['#FB6B58', '#076C01'],
  purple_deep_purple: ['#C288F7', '#2B0037'],
}));
export const CANONICAL_PAIRS = ['cream_blue', 'lilac_orange', 'mint_green', 'coral_green', 'purple_deep_purple'] as const;
export type PairId = typeof CANONICAL_PAIRS[number];
/** Aliases name the SAME assigned swatches; they never permit cross-pair mixing. */
export const PAIR_ALIASES: Readonly<Record<string, PairId>> = Object.freeze(Object.assign(Object.create(null), {
  'cream-blue': 'cream_blue', cream_royal_blue: 'cream_blue', 'cream-royal-blue': 'cream_blue',
  'lilac-orange': 'lilac_orange',
  'mint-green': 'mint_green', mint_deep_green: 'mint_green', 'mint-deepgreen': 'mint_green', 'mint-deep-green': 'mint_green',
  'coral-green': 'coral_green',
  purple: 'purple_deep_purple', 'purple-deeppurple': 'purple_deep_purple', 'purple-deep-purple': 'purple_deep_purple',
}));
export function resolvePair(id: unknown): PairId {
  if (typeof id !== 'string') throw Error('Pair id must be a string.');
  if (hasOwn(PAIRS, id)) return id as PairId;
  if (hasOwn(PAIR_ALIASES, id)) return PAIR_ALIASES[id];
  throw Error(`Unknown BFCM pair "${id}".`);
}
export function srgbHexToLinear(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw Error(`Invalid hex ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
}
export function pairLinear(pair: string, reversed = false): [[number, number, number], [number, number, number]] {
  const [ha, hb] = PAIRS[resolvePair(pair)];
  const a = srgbHexToLinear(ha), b = srgbHexToLinear(hb);
  return reversed ? [b, a] : [a, b];
}
/** The ten allowed palette states (five pairs × {normal, reversed}). */
export function paletteStates() {
  return CANONICAL_PAIRS.flatMap(p => [{ pair: p, reversed: false }, { pair: p, reversed: true }]);
}

// ------------------------------------------------------------------ manifest
export type Role = 'pigment' | 'fixed' | 'physical-separate' | 'pending';
export interface PigmentMap {
  url: string; sha256: string; format: 'ktx2'; width: number; height: number; mip_count: number;
  wrap: 'clamp' | 'repeat';
}
export interface PigmentSignals { coverage: number; mix: number; tone: number }
interface PigmentSource {
  default_a_linear: [number, number, number];
  default_b_linear: [number, number, number];
  vertex_color: 'none' | 'residual-only';
}
export type MappedPigment = PigmentSource & {
  constant?: never;
  map: string; texCoord: 0 | 1 | 2 | 3; uv_matrix: number[];
  tone_scale: number; tone_bias: number;
  /** Exact native signals override only truly uniform channels after data-map decoding. */
  channel_constants?: Partial<PigmentSignals>;
};
export type ConstantPigment = PigmentSource & {
  constant: PigmentSignals;
  map?: never; texCoord?: never; uv_matrix?: never; tone_scale?: never; tone_bias?: never;
  channel_constants?: never;
};
/** Exactly one of gltf_material_index / material_name identifies the glTF material. */
export interface MaterialBinding {
  material_id: string;
  gltf_material_index: number | null;
  material_name: string | null;
  role: Role;
  pigment: null | MappedPigment | ConstantPigment;
  /** Stock albedo was divided by this measured gain before encoding. Always active; default one. */
  stock_linear_gain?: number;
  /** Optional, newly baked AO. Legacy manifests have no AO and keep their accepted appearance. */
  baked_ao?: BakedAO;
}
const mapped = (p: MappedPigment | ConstantPigment): p is MappedPigment => p.constant === undefined;
export interface ProductManifest {
  schema: typeof MANIFEST_SCHEMA;
  product_id: string; model_id: string | null; source_native_sha256: string | null;
  default_pair: string;
  stock_base_color: 'default-palette';
  glb: { url: string; sha256: string; bytes: number } | null;
  native_hero: { url: string; sha256: string } | null;
  package_metrics: Record<string, number | null> | null;
  pigment_maps: Record<string, PigmentMap | null>;
  materials: MaterialBinding[];
  status: 'pending' | 'ready';
}

const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]*$/i;
const isInt = (n: unknown, lo: number, hi: number) => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
const fin = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;

export function validateUvMatrix(e: unknown) {
  if (!Array.isArray(e) || e.length !== 9 || !e.every(fin)) return 'uv_matrix must be 9 finite numbers';
  if (e[2] !== 0 || e[5] !== 0 || e[8] !== 1) return 'uv_matrix must be affine (column-major row 3 = 0,0,1)';
  if (Math.abs(e[0] * e[4] - e[1] * e[3]) < 1e-12) return 'uv_matrix is degenerate';
  return null;
}
function validateMap(k: string, p: PigmentMap | null, ready: boolean, fail: (r: string) => never) {
  if (p === null) { if (ready) fail(`pigment map ${k} pending in ready manifest`); return; }
  if (p.format !== 'ktx2' || !nonEmpty(p.url) || !HEX64.test(p.sha256)) fail(`pigment map ${k} ref`);
  if (!isInt(p.width, 1, 8192) || !isInt(p.height, 1, 8192)) fail(`pigment map ${k} dimensions`);
  const maxMips = Math.floor(Math.log2(Math.max(p.width, p.height))) + 1;
  if (!isInt(p.mip_count, 1, maxMips)) fail(`pigment map ${k} mip_count`);
  if (p.wrap !== 'clamp' && p.wrap !== 'repeat') fail(`pigment map ${k} wrap`);
}

/** Pure validation. `pending` manifests validate only with allowPending and never drive install. */
export function validateManifest(json: unknown, { allowPending = false } = {}): ProductManifest {
  const x = json as ProductManifest;
  const fail = (r: string): never => { throw Error(`Pigment manifest rejected (${(x as any)?.product_id ?? '?'}): ${r}`); };
  if (!x || typeof x !== 'object' || x.schema !== MANIFEST_SCHEMA) fail('schema');
  if (!nonEmpty(x.product_id) || !ID.test(x.product_id)) fail('product_id');
  resolvePair(x.default_pair);
  if (x.stock_base_color !== 'default-palette') fail('stock_base_color must be default-palette');
  if (x.status !== 'ready' && x.status !== 'pending') fail('status');
  if (x.status === 'pending' && !allowPending) fail('pending: stock GLB only');
  const ready = x.status === 'ready';
  if (ready) {
    if (!nonEmpty(x.model_id) || !HEX64.test(x.source_native_sha256 ?? '')) fail('source identity');
    if (!x.glb || !nonEmpty(x.glb.url) || !HEX64.test(x.glb.sha256) || !isInt(x.glb.bytes, 1, 2 ** 31)) fail('glb');
  }
  if (!x.pigment_maps || typeof x.pigment_maps !== 'object') fail('pigment_maps');
  for (const k of Object.keys(x.pigment_maps)) validateMap(k, x.pigment_maps[k], ready, fail);
  if (!Array.isArray(x.materials) || !x.materials.length) fail('materials');
  const ids = new Set<string>(), idx = new Set<number>(), names = new Set<string>();
  for (const m of x.materials) {
    if (!nonEmpty(m.material_id) || !ID.test(m.material_id) || ids.has(m.material_id)) fail(`material_id ${m.material_id}`);
    ids.add(m.material_id);
    const byIdx = m.gltf_material_index !== null && m.gltf_material_index !== undefined;
    const byName = m.material_name !== null && m.material_name !== undefined;
    if (byIdx === byName) fail(`binding ${m.material_id}: exactly one of gltf_material_index/material_name`);
    if (byIdx) { if (!isInt(m.gltf_material_index, 0, 65535) || idx.has(m.gltf_material_index!)) fail(`index ${m.material_id}`); idx.add(m.gltf_material_index!); }
    if (byName) { if (!nonEmpty(m.material_name) || names.has(m.material_name!)) fail(`name ${m.material_id}`); names.add(m.material_name!); }
    if (!['pigment', 'fixed', 'physical-separate', 'pending'].includes(m.role)) fail(`role ${m.material_id}`);
    if (ready && m.role === 'pending') fail(`unresolved role ${m.material_id}`);
    if (m.stock_linear_gain !== undefined && (!fin(m.stock_linear_gain) || m.stock_linear_gain < 1 || m.role !== 'pigment')) fail(`stock linear gain ${m.material_id}`);
    if (m.baked_ao !== undefined) {
      const ao = m.baked_ao;
      if (!ao || !hasOwn(x.pigment_maps, ao.map) || !isInt(ao.texCoord, 0, 3) || validateUvMatrix(ao.uv_matrix) || !fin(ao.intensity) || ao.intensity < 0 || ao.intensity > 1) fail(`baked AO ${m.material_id}`);
      if (m.role === 'physical-separate' || m.role === 'pending') fail(`baked AO on optical/pending role ${m.material_id}`);
    }
    if (m.role !== 'pigment') { if (m.pigment !== null) fail(`non-pigment ${m.material_id} carries pigment`); continue; }
    const p = m.pigment;
    if (!p) { if (ready) fail(`pigment binding ${m.material_id}`); continue; } // pending: texture not produced yet
    const validateSignals = (values: Partial<PigmentSignals>, complete: boolean) => {
      if (!values || typeof values !== 'object' || Array.isArray(values)) fail(`constant signals ${m.material_id}`);
      for (const k of Object.keys(values)) if (!['coverage', 'mix', 'tone'].includes(k)) fail(`unknown constant ${k} (${m.material_id})`);
      for (const k of ['coverage', 'mix', 'tone'] as const) {
        if (!hasOwn(values, k)) { if (complete) fail(`missing constant ${k} (${m.material_id})`); continue; }
        const v = values[k];
        if (!fin(v) || v! < 0 || (k !== 'tone' && v! > 1)) fail(`constant ${k} (${m.material_id})`);
      }
    };
    if (mapped(p!)) {
      if (!hasOwn(x.pigment_maps, p!.map)) fail(`map key ${m.material_id}`);
      if (!isInt(p!.texCoord, 0, 3)) fail(`texCoord ${m.material_id}`);
      const um = validateUvMatrix(p!.uv_matrix); if (um) fail(`${um} (${m.material_id})`);
      if (!fin(p!.tone_scale) || p!.tone_scale <= 0 || !fin(p!.tone_bias)) fail(`tone ${m.material_id}`);
      if (p!.channel_constants !== undefined) validateSignals(p!.channel_constants, false);
    } else {
      for (const k of ['map', 'texCoord', 'uv_matrix', 'tone_scale', 'tone_bias', 'channel_constants']) {
        if (hasOwn(p!, k)) fail(`constant binding carries ${k} (${m.material_id})`);
      }
      validateSignals(p!.constant, true);
    }
    for (const k of ['default_a_linear', 'default_b_linear'] as const) {
      const v = p![k];
      if (!Array.isArray(v) || v.length !== 3 || !v.every(n => fin(n) && n >= 0)) fail(`source pigment ${k} (${m.material_id})`);
    }
    if (p!.vertex_color !== 'none' && p!.vertex_color !== 'residual-only') fail(`vertex_color ${m.material_id}`);
  }
  return x;
}

export async function sha256Hex(bytes: ArrayBuffer) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}
export async function verifySha256(bytes: ArrayBuffer, expected: string) {
  if ((await sha256Hex(bytes)) !== expected) throw Error('Pigment data hash mismatch.');
}

// ------------------------------------------------------------------ shader patch (pure strings)
const UV_NAMES = ['uv', 'uv1', 'uv2', 'uv3'] as const;
export const aliasName = (texCoord: number) => `bfcmPigmentUv${texCoord}`;
const ANCHORS = {
  vertex: ['#include <common>', '#include <uv_vertex>'],
  fragment: ['#include <common>', '#include <color_fragment>'],
} as const;
const count = (s: string, a: string) => s.split(a).length - 1;
/** Checks all four anchors occur exactly once BEFORE modifying; returns patched sources. */
export function patchShaders(vertex: string, fragment: string, texCoord: number | null) {
  for (const a of ANCHORS.vertex) if (count(vertex, a) !== 1) throw Error(`Vertex anchor ${a} count ${count(vertex, a)} != 1`);
  for (const a of ANCHORS.fragment) if (count(fragment, a) !== 1) throw Error(`Fragment anchor ${a} count ${count(fragment, a)} != 1`);
  const constant = texCoord === null;
  const uv = constant ? '' : aliasName(texCoord);
  const vertexDeclarations = constant ? '' : `\nattribute vec2 ${uv};\nuniform mat3 bfcmPigmentUvMatrix;\nvarying vec2 vBfcmPigmentUv;`;
  const fragmentDeclarations = constant ? '\nuniform vec3 bfcmConstantSignals;' : '\nuniform sampler2D bfcmPigmentMap;\nuniform float bfcmToneScale;\nuniform float bfcmToneBias;\nuniform vec3 bfcmChannelConstants;\nuniform vec3 bfcmChannelMask;\nvarying vec2 vBfcmPigmentUv;';
  const texel = constant ? '' : '\nvec4 bfcmPigmentTexel = texture2D( bfcmPigmentMap, vBfcmPigmentUv );';
  const signals = constant ? 'vec3 bfcmS = bfcmConstantSignals;' : `vec3 bfcmS = bfcmPigmentTexel.rgb;
  bfcmS.b = bfcmToneBias + bfcmToneScale * bfcmS.b;
  bfcmS = mix( bfcmS, bfcmChannelConstants, bfcmChannelMask );`;
  return {
    vertex: vertex
      .replace('#include <common>', `#include <common>${vertexDeclarations}`)
      .replace('#include <uv_vertex>', constant ? '#include <uv_vertex>' : `#include <uv_vertex>\nvBfcmPigmentUv = ( bfcmPigmentUvMatrix * vec3( ${uv}, 1.0 ) ).xy;`),
    fragment: fragment
      .replace('#include <common>', `#include <common>\nuniform float bfcmPigmentEnabled;\nuniform float bfcmStockLinearGain;\nuniform vec3 bfcmPigmentA;\nuniform vec3 bfcmPigmentB;\nuniform vec3 bfcmSourceA;\nuniform vec3 bfcmSourceB;${fragmentDeclarations}`)
      .replace('#include <color_fragment>', `#include <color_fragment>${texel}
{
  ${signals}
  diffuseColor.rgb *= bfcmStockLinearGain;
  vec3 bfcmDelta = mix( bfcmPigmentA, bfcmPigmentB, bfcmS.g ) - mix( bfcmSourceA, bfcmSourceB, bfcmS.g );
  diffuseColor.rgb += bfcmPigmentEnabled * bfcmS.r * bfcmS.b * bfcmDelta;
}`),
  };
}
/** Structural key contains signal route and UV channel; palette and constant values are uniforms. */
export function structuralKey(materialType: string, texCoord: number | null, vertexColor: string) {
  return [ADAPTER_VERSION, materialType, texCoord === null ? 'constant' : `uv${texCoord}`, vertexColor].join('|');
}

// ------------------------------------------------------------------ handles
type Std = THREE.MeshStandardMaterial;
export interface PigmentHandle {
  readonly material: Std; readonly binding: MaterialBinding; readonly texture: THREE.Texture | null;
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly prevCompile: Std['onBeforeCompile']; readonly prevKey: Std['customProgramCacheKey'];
  readonly priorCustomHooks: boolean;
  ao?: AOHandle;
  readonly sourcePair?: PairId;
  pair: PairId; reversed: boolean; disposed: boolean;
}
const OWNED = new WeakMap<THREE.Material, PigmentHandle>();
export const handleOf = (m: THREE.Material) => OWNED.get(m);

function checkInstallable(material: THREE.Material, b: MaterialBinding) {
  if (!(material instanceof THREE.MeshStandardMaterial)) throw Error(`Material ${b.material_id} is not Standard/Physical.`);
  if (b.role !== 'pigment' || !b.pigment) throw Error(`Material ${b.material_id} is not pigment-eligible.`);
  if (b.stock_linear_gain !== undefined && (!fin(b.stock_linear_gain) || b.stock_linear_gain < 1)) throw Error(`Invalid stock linear gain for ${b.material_id}.`);
  if (OWNED.has(material)) throw Error(`Adapter already installed on ${b.material_id}.`);
  if (material.vertexColors && b.pigment.vertex_color === 'none') throw Error(`Vertex-colour convention undeclared for ${b.material_id}.`);
  return material;
}

/** Low-level install on one material (geometry aliasing is the caller's/applyManifest's job). */
export function install(material: THREE.Material, texture: THREE.Texture | null, binding: MaterialBinding, pair: string, reversed = false, sourcePair?: string, aoTexture?: THREE.Texture): PigmentHandle {
  const m = checkInstallable(material, binding), p = binding.pigment!;
  if (binding.baked_ao) {
    checkAO(m);
    if (!aoTexture) throw Error(`Missing baked AO texture for ${binding.material_id}.`);
  }
  const key = resolvePair(pair);
  const sourceKey = sourcePair === undefined ? undefined : resolvePair(sourcePair);
  const [a, b] = sourceKey === key
    ? (reversed ? [p.default_b_linear, p.default_a_linear] : [p.default_a_linear, p.default_b_linear])
    : pairLinear(key, reversed);
  const uniforms: Record<string, THREE.IUniform> = {
    bfcmPigmentEnabled: { value: 1 },
    bfcmStockLinearGain: { value: binding.stock_linear_gain ?? 1 },
    bfcmPigmentA: { value: new THREE.Color().setRGB(a[0], a[1], a[2], THREE.LinearSRGBColorSpace) },
    bfcmPigmentB: { value: new THREE.Color().setRGB(b[0], b[1], b[2], THREE.LinearSRGBColorSpace) },
    bfcmSourceA: { value: new THREE.Color().fromArray(p.default_a_linear) },
    bfcmSourceB: { value: new THREE.Color().fromArray(p.default_b_linear) },
  };
  const texCoord = mapped(p) ? p.texCoord : null;
  if (mapped(p)) {
    if (!texture) throw Error(`Mapped pigment ${binding.material_id} has no texture.`);
    const c = p.channel_constants ?? {};
    Object.assign(uniforms, {
      bfcmPigmentMap: { value: texture },
      bfcmPigmentUvMatrix: { value: new THREE.Matrix3().fromArray(p.uv_matrix) },
      bfcmToneScale: { value: p.tone_scale }, bfcmToneBias: { value: p.tone_bias },
      bfcmChannelConstants: { value: new THREE.Vector3(c.coverage ?? 0, c.mix ?? 0, c.tone ?? 0) },
      bfcmChannelMask: { value: new THREE.Vector3(Number(c.coverage !== undefined), Number(c.mix !== undefined), Number(c.tone !== undefined)) },
    });
  } else uniforms.bfcmConstantSignals = { value: new THREE.Vector3(p.constant.coverage, p.constant.mix, p.constant.tone) };
  const priorCustomHooks = hasOwn(m, 'onBeforeCompile') || hasOwn(m, 'customProgramCacheKey');
  const prevCompile = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  const sk = structuralKey(m.type, texCoord, p.vertex_color);
  m.onBeforeCompile = function (shader, renderer) {
    prevCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    const out = patchShaders(shader.vertexShader, shader.fragmentShader, texCoord);
    shader.vertexShader = out.vertex; shader.fragmentShader = out.fragment;
  };
  m.customProgramCacheKey = function () { return prevKey.call(this) + '|' + sk; };
  m.needsUpdate = true;
  const h: PigmentHandle = { material: m, binding, texture, uniforms, prevCompile, prevKey, priorCustomHooks, sourcePair: sourceKey, pair: key, reversed, disposed: false };
  if (binding.baked_ao) {
    h.ao = installAO(m, aoTexture!, binding.baked_ao, sharesAO(binding));
  }
  OWNED.set(m, h);
  return h;
}

/** Uniform writes only: no needsUpdate, reload or recompile. */
export function updatePalette(h: PigmentHandle, pair: string, reversed = false) {
  if (h.disposed) throw Error('Pigment handle disposed.');
  const key = resolvePair(pair), p = h.binding.pigment!;
  const [a, b] = h.sourcePair === key
    ? (reversed ? [p.default_b_linear, p.default_a_linear] : [p.default_a_linear, p.default_b_linear])
    : pairLinear(key, reversed);
  (h.uniforms.bfcmPigmentA.value as THREE.Color).setRGB(a[0], a[1], a[2], THREE.LinearSRGBColorSpace);
  (h.uniforms.bfcmPigmentB.value as THREE.Color).setRGB(b[0], b[1], b[2], THREE.LinearSRGBColorSpace);
  h.pair = key; h.reversed = reversed;
}

/**
 * Material.clone() drops hooks. If the source had pre-adapter custom hooks (another bridge), their closures may
 * own per-material state, so a `reinstallPrior(copy)` callback is REQUIRED to rebuild them; otherwise rejected.
 */
export function clone(h: PigmentHandle, opts: { pair?: string; reversed?: boolean; reinstallPrior?: (copy: Std) => void } = {}) {
  if (h.disposed) throw Error('Pigment handle disposed.');
  if (h.priorCustomHooks && !opts.reinstallPrior) throw Error('Clone rejected: prior custom hooks need an explicit reinstallPrior callback.');
  const copy = h.material.clone();
  // clone() leaves prototype hooks; never copy the original's closures.
  delete (copy as any).onBeforeCompile; delete (copy as any).customProgramCacheKey;
  opts.reinstallPrior?.(copy);
  const cloned = install(copy, h.texture, h.binding, opts.pair ?? h.pair, opts.reversed ?? h.reversed, h.sourcePair, h.ao?.texture);
  cloned.uniforms.bfcmPigmentEnabled.value = h.uniforms.bfcmPigmentEnabled.value;
  if (cloned.ao && h.ao) cloned.ao.uniform.value = h.ao.uniform.value;
  return cloned;
}

/** Another bridge replaced the material object: release old ownership, install on replacement, keep palette state. */
export function reinstall(h: PigmentHandle, replacement: THREE.Material) {
  if (h.disposed) throw Error('Pigment handle disposed.');
  checkInstallable(replacement, h.binding);
  if (h.binding.baked_ao) checkAO(replacement);
  const { pair, reversed } = h;
  const enabled = h.uniforms.bfcmPigmentEnabled.value, aoIntensity = h.ao?.uniform.value;
  dispose(h);
  const installed = install(replacement, h.texture, h.binding, pair, reversed, h.sourcePair, h.ao?.texture);
  installed.uniforms.bfcmPigmentEnabled.value = enabled;
  if (installed.ao && aoIntensity !== undefined) installed.ao.uniform.value = aoIntensity;
  return installed;
}

/** Restores previous hooks; texture lifetime belongs to PigmentTextureCache, stock maps are never touched. */
export function dispose(h: PigmentHandle) {
  if (h.disposed) return;
  h.ao?.dispose();
  const m = h.material as any;
  if (h.priorCustomHooks) { m.onBeforeCompile = h.prevCompile; m.customProgramCacheKey = h.prevKey; }
  else { delete m.onBeforeCompile; delete m.customProgramCacheKey; }
  // Three r187 stores uniforms per material, not per cached program. Release its GPU
  // program cache before restoring/reinstalling hooks so a stale uniform table cannot return.
  // Material.dispose does not dispose its textures or make the material unusable.
  m.dispose(); m.needsUpdate = true; OWNED.delete(h.material); h.disposed = true;
}

// ------------------------------------------------------------------ transactional product apply
export interface Indexer { (material: THREE.Material): number | undefined }  // gltf.parser.associations
export interface Applied { handles: PigmentHandle[]; aoHandles: AOHandle[]; rollback(): void }
function sharesAO(b: MaterialBinding) {
  const p = b.pigment, ao = b.baked_ao;
  return !!(p && mapped(p) && ao && p.map === ao.map && p.texCoord === ao.texCoord && p.uv_matrix.every((v, i) => v === ao.uv_matrix[i]));
}

/**
 * Validate everything, then mutate. Any failure during mutation rolls back hooks and aliases it added,
 * leaving the stock (default-palette) GLB materials exactly as loaded.
 */
export function applyManifest(scene: THREE.Object3D, manifest: ProductManifest, indexOf: Indexer,
  textures: ReadonlyMap<string, THREE.Texture>, pair = manifest.default_pair, reversed = false): Applied {
  validateManifest(manifest);
  resolvePair(pair);
  const byIdx = new Map<number, MaterialBinding>(), byName = new Map<string, MaterialBinding>();
  for (const b of manifest.materials) b.gltf_material_index !== null ? byIdx.set(b.gltf_material_index, b) : byName.set(b.material_name!, b);
  // ---- phase 1: resolve + validate (no mutation)
  const meshesOf = new Map<THREE.Material, THREE.Mesh[]>(), seenNames = new Map<string, Set<THREE.Material>>();
  const bound = new Map<THREE.Material, MaterialBinding>(), hit = new Set<MaterialBinding>();
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
      (meshesOf.get(mat) ?? meshesOf.set(mat, []).get(mat)!).push(node);
      (seenNames.get(mat.name) ?? seenNames.set(mat.name, new Set()).get(mat.name)!).add(mat);
    }
  });
  for (const mat of meshesOf.keys()) {
    const i = indexOf(mat);
    const bi = i !== undefined ? byIdx.get(i) : undefined, bn = byName.get(mat.name);
    if (bi && bn && bi !== bn) throw Error(`Material ${mat.name} matches two bindings.`);
    const b = bi ?? bn; if (!b) continue;
    if (bn && seenNames.get(mat.name)!.size > 1) throw Error(`Name binding "${mat.name}" is ambiguous (${seenNames.get(mat.name)!.size} materials).`);
    const exported = mat.userData?.bfcm_material_id;
    if (exported !== undefined && exported !== b.material_id) throw Error(`Exported id ${exported} != binding ${b.material_id}.`);
    bound.set(mat, b); hit.add(b);
  }
  for (const b of manifest.materials) if ((b.role === 'pigment' || b.baked_ao) && !hit.has(b)) throw Error(`Binding ${b.material_id} not found in scene.`);
  const plan: Array<[THREE.Material, MaterialBinding, THREE.Texture | null]> = [];
  const aliasPlan = new Map<THREE.BufferGeometry, Set<number>>();
  const aoAliasPlan = new Map<THREE.BufferGeometry, Set<number>>();
  const aoPlan: Array<[THREE.Material, MaterialBinding, THREE.Texture]> = [];
  for (const [mat, b] of bound) {
    if (b.baked_ao) {
      checkAO(mat);
      const ao = b.baked_ao, texture = textures.get(ao.map);
      if (!texture) throw Error(`Baked AO map ${ao.map} not supplied.`);
      if (!sharesAO(b)) for (const mesh of meshesOf.get(mat)!) {
        const src = mesh.geometry.getAttribute(UV_NAMES[ao.texCoord]), cur = mesh.geometry.getAttribute(aoAlias(ao.texCoord));
        if (!src || src.itemSize !== 2 || (cur && cur !== src)) throw Error(`AO UV conflict/missing channel on ${mesh.name}.`);
        (aoAliasPlan.get(mesh.geometry) ?? aoAliasPlan.set(mesh.geometry, new Set()).get(mesh.geometry)!).add(ao.texCoord);
      }
      aoPlan.push([mat, b, texture]);
    }
    if (b.role !== 'pigment') continue;
    checkInstallable(mat, b);
    const p = b.pigment!;
    const tex = mapped(p) ? textures.get(p.map) : null;
    if (mapped(p)) {
      if (!tex) throw Error(`Texture for map ${p.map} not supplied.`);
      for (const mesh of meshesOf.get(mat)!) {
        const src = mesh.geometry.getAttribute(UV_NAMES[p.texCoord]);
        if (!src || src.itemSize !== 2) throw Error(`Mesh ${mesh.name} lacks ${UV_NAMES[p.texCoord]} for ${b.material_id}.`);
        const cur = mesh.geometry.getAttribute(aliasName(p.texCoord));
        if (cur && cur !== src) throw Error(`Shared-UV conflict on ${mesh.name}: ${aliasName(p.texCoord)} already bound elsewhere.`);
        (aliasPlan.get(mesh.geometry) ?? aliasPlan.set(mesh.geometry, new Set()).get(mesh.geometry)!).add(p.texCoord);
      }
    }
    plan.push([mat, b, tex ?? null]);
  }
  const probe = THREE.ShaderLib.physical; // Standard and Physical share this source in r187
  for (const [, b] of plan) {
    const out = patchShaders(probe.vertexShader, probe.fragmentShader, mapped(b.pigment!) ? b.pigment!.texCoord : null);
    if (b.baked_ao) patchAO(out.vertex, out.fragment, b.baked_ao, sharesAO(b));
  }
  for (const [, b] of aoPlan) if (b.role !== 'pigment') patchAO(probe.vertexShader, probe.fragmentShader, b.baked_ao!, false);
  // ---- phase 2: mutate with rollback
  const handles: PigmentHandle[] = [], aoHandles: AOHandle[] = [], added: Array<[THREE.BufferGeometry, string]> = [];
  const rollback = () => {
    for (const h of aoHandles.splice(0)) h.dispose();
    for (const h of handles.splice(0)) dispose(h);
    for (const [g, n] of added.splice(0)) g.deleteAttribute(n);
  };
  try {
    for (const [g, chans] of aliasPlan) for (const c of chans) {
      const n = aliasName(c);
      if (!g.getAttribute(n)) { g.setAttribute(n, g.getAttribute(UV_NAMES[c])); added.push([g, n]); }
    }
    for (const [g, chans] of aoAliasPlan) for (const c of chans) {
      const n = aoAlias(c);
      if (!g.getAttribute(n)) { g.setAttribute(n, g.getAttribute(UV_NAMES[c])); added.push([g, n]); }
    }
    for (const [mat, b, tex] of plan) {
      const h = install(mat, tex, b, pair, reversed, manifest.default_pair, b.baked_ao ? textures.get(b.baked_ao.map) : undefined);
      handles.push(h); if (h.ao) aoHandles.push(h.ao);
    }
    for (const [mat, b, tex] of aoPlan) if (b.role !== 'pigment') aoHandles.push(installAO(mat, tex, b.baked_ao!));
  } catch (e) { rollback(); throw e; }
  return { handles, aoHandles, rollback };
}

// ------------------------------------------------------------------ texture cache
/**
 * Bytes decoded once per sha256; one Texture per (sha256, sampler) sharing the same Source.
 * Rejected loads are evicted (no stale failure, refs not leaked). Release is synchronous on the
 * refcount, so an acquire during disposal starts a fresh entry. Only cache-loaded textures are disposed.
 */
export class PigmentTextureCache {
  private readonly bases = new Map<string, { p: Promise<THREE.Texture>; refs: number }>();
  private readonly views = new Map<string, { p: Promise<THREE.Texture>; refs: number; sha: string }>();
  private readonly load: (map: PigmentMap) => Promise<THREE.Texture>;
  constructor(load: (map: PigmentMap) => Promise<THREE.Texture>) { this.load = load; }
  static key(m: PigmentMap) { return `${m.sha256}|${m.wrap}`; }
  acquire(m: PigmentMap): Promise<THREE.Texture> {
    const k = PigmentTextureCache.key(m);
    const v = this.views.get(k); if (v) { v.refs++; return v.p; }
    let base = this.bases.get(m.sha256);
    if (!base) {
      const p = this.load(m);
      const entry = { p, refs: 0 }; base = entry; this.bases.set(m.sha256, entry);
      p.catch(() => { if (this.bases.get(m.sha256) === entry) this.bases.delete(m.sha256); });
    }
    base.refs++;
    const view = {
      sha: m.sha256, refs: 1,
      p: base.p.then(t => { const c = t.clone(); c.source = t.source; return configurePigmentTexture(c, m); }),
    };
    this.views.set(k, view);
    view.p.catch(() => { if (this.views.get(k) === view) { this.views.delete(k); this.unrefBase(m.sha256); } });
    return view.p;
  }
  /** Returns false for unknown/over-release (guarded no-op). */
  release(m: PigmentMap): boolean {
    const k = PigmentTextureCache.key(m), v = this.views.get(k);
    if (!v) return false;
    if (--v.refs > 0) return true;
    this.views.delete(k);
    v.p.then(t => t.dispose(), () => {});
    this.unrefBase(v.sha);
    return true;
  }
  private unrefBase(sha: string) {
    const b = this.bases.get(sha); if (!b) return;
    if (--b.refs > 0) return;
    this.bases.delete(sha);
    b.p.then(t => t.dispose(), () => {});
  }
  get counts() { return { bases: this.bases.size, views: this.views.size }; }
}

/** Linear data, authored coverage-weighted mips, glTF orientation. Matrix stays in the per-material uniform. */
export function configurePigmentTexture(t: THREE.Texture, m: PigmentMap) {
  t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.generateMipmaps = false;
  t.wrapS = t.wrapT = m.wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = m.mip_count > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter; t.matrixAutoUpdate = false;
  t.needsUpdate = true;
  return t;
}
