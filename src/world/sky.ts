/** 天穹：内翻球 + skyColor 程序化渐变。 */
import * as THREE from 'three';
import { SKY_FRAG, SKY_VERT } from '../core/shaders';

export class Sky {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uTime: { value: 0 } },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 20), this.mat);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
  }
  update(t: number): void {
    this.mat.uniforms.uTime.value = t;
  }
}
