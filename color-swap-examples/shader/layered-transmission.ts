import * as THREE from 'three';

/** A shared screen-space pass for an inner volume enclosed by another volume.
 * Uses ordinary MeshPhysicalMaterial in both passes. No pigment/PBR rewrites.
 * This remains a diagnostic candidate until the full bottle is reviewed.
 * Current callers render from the default framebuffer. Arbitrary host target
 * viewport, cube face and mip-level restoration require a separate handoff.
 */
export class LayeredTransmission {
  private readonly inner = new Set<THREE.Object3D>();
  private readonly outer = new Set<THREE.Object3D>();
  private image?: THREE.WebGLRenderTarget;
  private readonly visibility: { node: THREE.Object3D; visible: boolean }[] = [];
  private readonly viewport = new THREE.Vector4();
  private readonly scissor = new THREE.Vector4();

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene) {}

  layers(inner: THREE.Object3D[], outer: THREE.Object3D[]) {
    this.inner.clear(); this.outer.clear();
    inner.forEach(node => this.inner.add(node)); outer.forEach(node => this.outer.add(node));
    this.visibility.length = 0;
    [...this.inner, ...this.outer].forEach(node => this.visibility.push({ node, visible: node.visible }));
    if (!inner.length || !outer.length) { this.image?.dispose(); this.image = undefined; }
  }

  render(camera: THREE.Camera, width: number, height: number, composite: () => void) {
    if (!this.inner.size || !this.outer.size) { composite(); return; }
    const r = this.renderer, background = this.scene.background;
    this.visibility.forEach(item => { item.visible = item.node.visible; });
    const state = {
      target: r.getRenderTarget(), scissorTest: r.getScissorTest(), autoClear: r.autoClear,
      shadowEnabled: r.shadowMap.enabled, shadowType: r.shadowMap.type,
      shadowAuto: r.shadowMap.autoUpdate, shadowNeeds: r.shadowMap.needsUpdate,
    };
    r.getViewport(this.viewport); r.getScissor(this.scissor);
    this.image ??= new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType, samples: 4, colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.image.setSize(Math.max(2, Math.round(width)), Math.max(2, Math.round(height)));
    try {
      this.outer.forEach(node => { node.visible = false; });
      r.autoClear = false; r.setScissorTest(false);
      r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
      r.shadowMap.autoUpdate = r.shadowMap.needsUpdate = true;
      r.setRenderTarget(this.image); r.clear(); r.render(this.scene, camera);
      // Offscreen beauty is linear. The established studio's final blit applies
      // tone mapping and output conversion once, after this second PBR render.
      this.visibility.forEach(item => { item.node.visible = item.visible; });
      this.inner.forEach(node => { node.visible = false; });
      this.scene.background = this.image.texture;
      r.setRenderTarget(state.target); r.setViewport(this.viewport); r.setScissor(this.scissor);
      r.setScissorTest(state.scissorTest); composite();
    } finally {
      this.visibility.forEach(item => { item.node.visible = item.visible; });
      this.scene.background = background;
      r.setRenderTarget(state.target); r.setViewport(this.viewport); r.setScissor(this.scissor);
      r.setScissorTest(state.scissorTest); r.autoClear = state.autoClear;
      r.shadowMap.enabled = state.shadowEnabled; r.shadowMap.type = state.shadowType;
      r.shadowMap.autoUpdate = state.shadowAuto; r.shadowMap.needsUpdate = state.shadowNeeds;
    }
  }

  dispose() { this.image?.dispose(); this.image = undefined; this.inner.clear(); this.outer.clear(); this.visibility.length = 0; }
}
