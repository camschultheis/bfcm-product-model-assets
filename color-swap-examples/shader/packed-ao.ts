import * as THREE from 'three';

/** Linear visibility in a packed data map's alpha; independent from color and opacity. */
export interface BakedAO { map: string; texCoord: 0 | 1 | 2 | 3; uv_matrix: number[]; intensity: number }
export interface AOHandle {
  material: THREE.MeshStandardMaterial; texture: THREE.Texture; binding: BakedAO;
  uniform: THREE.IUniform<number>; dispose(): void;
}
export const aoAlias = (channel: number) => `bfcmAOUv${channel}`;
export function checkAO(material: THREE.Material) {
  if (!(material instanceof THREE.MeshStandardMaterial)) throw Error('Baked AO requires a Standard/Physical material.');
  if (material.aoMap) throw Error('Packed AO would duplicate an existing aoMap.');
  if (material.transparent || (material instanceof THREE.MeshPhysicalMaterial && material.transmission > 0)) throw Error('Opaque baked AO cannot be applied to a transparent optical material.');
  return material;
}

/** Reuse the existing pigment sample when both maps share their exact UV route. */
export function patchAO(vertex: string, fragment: string, binding: BakedAO, sharedPigmentSample: boolean) {
  for (const [source, anchor] of [[vertex, '#include <common>'], [vertex, '#include <uv_vertex>'], [fragment, '#include <common>'], [fragment, '#include <aomap_fragment>']]) {
    if (source.split(anchor).length !== 2) throw Error(`Packed AO anchor ${anchor} must occur once.`);
  }
  const declarations = sharedPigmentSample ? '' : '\nuniform sampler2D bfcmAOMap;\nvarying vec2 vBfcmAOUv;';
  const visibility = sharedPigmentSample ? 'bfcmPigmentTexel.a' : 'texture2D( bfcmAOMap, vBfcmAOUv ).a';
  // Keep the installed Three revision's diffuse, clearcoat, sheen and specular AO behavior.
  const stock = THREE.ShaderChunk.aomap_fragment;
  if (!stock.trim().startsWith('#ifdef USE_AOMAP') || !stock.trim().endsWith('#endif')) throw Error('Three AO chunk changed.');
  const body = stock.trim().replace(/^#ifdef USE_AOMAP\s*/, '').replace(/#endif\s*$/, '')
    .replace('float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;', `float ambientOcclusion = ( ${visibility} - 1.0 ) * bfcmAOIntensity + 1.0;`);
  if (body.includes('aoMapIntensity')) throw Error('Three AO equation changed.');
  return {
    vertex: sharedPigmentSample ? vertex : vertex
      .replace('#include <common>', `#include <common>\nattribute vec2 ${aoAlias(binding.texCoord)};\nuniform mat3 bfcmAOUvMatrix;\nvarying vec2 vBfcmAOUv;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvBfcmAOUv = ( bfcmAOUvMatrix * vec3( ${aoAlias(binding.texCoord)}, 1.0 ) ).xy;`),
    fragment: fragment.replace('#include <common>', `#include <common>\nuniform float bfcmAOIntensity;${declarations}`)
      .replace('#include <aomap_fragment>', body),
  };
}

export function installAO(material: THREE.Material, texture: THREE.Texture, binding: BakedAO, sharedPigmentSample = false): AOHandle {
  const m = checkAO(material), previousCompile = m.onBeforeCompile, previousKey = m.customProgramCacheKey;
  const uniform = { value: binding.intensity }, uniforms = {
    bfcmAOIntensity: uniform,
    ...(!sharedPigmentSample && { bfcmAOMap: { value: texture }, bfcmAOUvMatrix: { value: new THREE.Matrix3().fromArray(binding.uv_matrix) } }),
  };
  const key = `packed-ao-alpha1|${sharedPigmentSample ? 'pigment-sample' : `uv${binding.texCoord}`}`;
  m.onBeforeCompile = function(shader, renderer) {
    previousCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    const out = patchAO(shader.vertexShader, shader.fragmentShader, binding, sharedPigmentSample);
    shader.vertexShader = out.vertex; shader.fragmentShader = out.fragment;
  };
  m.customProgramCacheKey = function() { return previousKey.call(this) + '|' + key; };
  m.needsUpdate = true;
  let disposed = false;
  return { material: m, texture, binding, uniform, dispose() {
    if (disposed) return; disposed = true;
    m.onBeforeCompile = previousCompile; m.customProgramCacheKey = previousKey;
    m.dispose(); m.needsUpdate = true;
  } };
}
