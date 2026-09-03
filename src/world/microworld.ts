/**
 * 微观露珠世界（相机穿入花心的一段）：
 *  - 巨大化露珠（球体 + 折射天穹 + 内部焦散高光），随 micro 淡入淡出。
 *  - 花芯绒丝（细长发光丝），花粉飞絮。
 * 位置在主角花 (4.9,1.7,0.4) 附近，进入/退出由 phase.micro 控制可见与缩放。
 */
import * as THREE from 'three';
import { CHUNK_COMMON, CHUNK_FRESNEL } from '../core/shaders';
import { clamp, hash21 } from '../core/math';
import { PALETTE, lin } from '../core/palette';

const DEW_FRAG = /* glsl */ `
${CHUNK_COMMON}
${CHUNK_FRESNEL}
uniform vec3 uCamPos; uniform float uTime; uniform float uOpacity;
varying vec3 vN; varying vec3 vWorld;
void main(){
  vec3 N=normalize(vN); vec3 V=normalize(uCamPos-vWorld);
  float fres=fresnel(N,V,0.02);
  vec3 refl=skyColor(reflect(-V,N));
  vec3 refr=skyColor(refract(-V,N,0.72));
  vec3 col=mix(refr,refl,clamp(fres*1.3,0.0,1.0));
  col+=ENV_PEARL*pow(max(dot(reflect(-V,N),normalize(vec3(0.4,0.85,0.3))),0.0),160.0)*2.2;
  // 焦散内核亮斑
  float ca=pow(1.0-abs(dot(N,V)),3.0);
  col+=mix(ENV_CORAL,ENV_APRICOT,0.5)*ca*0.5;
  gl_FragColor=vec4(col,clamp(0.25+fres*0.7,0.0,1.0)*uOpacity);
}`;

export class MicroWorld {
  group = new THREE.Group();
  private dewMats: THREE.ShaderMaterial[] = [];
  private filaments: THREE.LineSegments;
  private filaMat: THREE.ShaderMaterial;
  private center = new THREE.Vector3(5.0, 1.7, -2.6);
  constructor(camera: THREE.Camera) {
    const camU = { value: new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld) };
    const geo = new THREE.SphereGeometry(1, 28, 22);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vWorld; void main(){ vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;}`,
        fragmentShader: DEW_FRAG,
        uniforms: { uCamPos: camU, uTime: { value: 0 }, uOpacity: { value: 0 } },
        transparent: true, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, m);
      const a = hash21(i, 1) * Math.PI * 2;
      const r = 0.6 + hash21(i, 2) * 3.2;
      mesh.position.set(this.center.x + Math.cos(a) * r, this.center.y - 1.0 + hash21(i, 3) * 3.2, this.center.z + Math.sin(a) * r);
      const s = 0.08 + hash21(i, 4) * 0.26;
      mesh.scale.setScalar(s);
      mesh.renderOrder = 22;
      this.group.add(mesh);
      this.dewMats.push(m);
    }
    // 花芯绒丝：基点分布在花心圆环上（避免从单点放射成激光扇）
    const pts: number[] = [];
    const cols: number[] = [];
    const nF = 90;
    const coral = lin(PALETTE.coral), apr = lin(PALETTE.apricot), lem = lin(PALETTE.lemon);
    for (let i = 0; i < nF; i++) {
      const a = (i / nF) * Math.PI * 2 * 5 + hash21(i, 9);
      const t = i / nF;
      const baseA = (i / nF) * Math.PI * 2;
      const baseR = 0.18 + hash21(i, 21) * 0.22;
      const rad = 0.3 + t * 0.7;
      const x0 = this.center.x + Math.cos(baseA) * baseR;
      const y0 = this.center.y + 1.4 + hash21(i, 23) * 0.2;   // 移到相机上方，避免穿脸
      const z0 = this.center.z + Math.sin(baseA) * baseR;
      const x1 = x0 + Math.cos(a) * rad;
      const y1 = y0 + 0.9 + t * 0.7 + Math.sin(a) * 0.1;
      const z1 = z0 + Math.sin(a) * rad;
      pts.push(x0, y0, z0, x1, y1, z1);
      const c = i % 3 === 0 ? lem : i % 2 === 0 ? coral : apr;
      cols.push(c[0], c[1], c[2], c[0] * 0.5, c[1] * 0.5, c[2] * 0.5);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.filaMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec3 vC; attribute vec3 color; void main(){ vC=color; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: /* glsl */ `varying vec3 vC; uniform float uOpacity; void main(){ gl_FragColor=vec4(vC*1.4,uOpacity);}`,
      uniforms: { uOpacity: { value: 0 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.filaments = new THREE.LineSegments(lg, this.filaMat);
    this.filaments.renderOrder = 23;
    this.group.add(this.filaments);
    this.group.visible = false;
  }
  update(t: number, micro: number, gather: number, _camera: THREE.Camera): void {
    const vis = micro * (1 - gather);
    this.group.visible = vis > 0.01;
    if (this.group.visible) {
      for (const m of this.dewMats) {
        m.uniforms.uTime.value = t;
        m.uniforms.uOpacity.value = clamp(vis * 1.1, 0, 1);
      }
      this.filaMat.uniforms.uOpacity.value = vis * 0.28;
    }
  }
}
