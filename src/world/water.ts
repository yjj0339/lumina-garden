/**
 * 水面系统：主水面（顶点位移涟漪 + 片元焦散/反射/折射）+ 池底焦散投影。
 * 涟漪按“活跃窗口”上传 uniform（旧波到期剔除），保证移动端 uniform 压力可控。
 */
import * as THREE from 'three';
import { waterSurfaceFrag, waterSurfaceVert } from '../core/shaders';
import type { Events } from '../core/events';

const MAXR = 12;

export class Water {
  mesh: THREE.Mesh;
  bed: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private bedMat: THREE.ShaderMaterial;
  private events: Events;
  private camU: { value: THREE.Vector3 };
  private ripA: THREE.Vector4[] = [];
  private ripB: THREE.Vector4[] = [];
  private ripC: THREE.Vector3[] = [];
  /** 当前画质等级：影响网格密度（重建时读取） */
  constructor(events: Events, _camera: THREE.Camera, seg: number) {
    this.events = events;
    this.camU = { value: new THREE.Vector3() };
    for (let i = 0; i < MAXR; i++) {
      this.ripA.push(new THREE.Vector4(0, 0, -1, 0));
      this.ripB.push(new THREE.Vector4(1, 1, 0, 1));
      this.ripC.push(new THREE.Vector3());
    }
    this.mat = new THREE.ShaderMaterial({
      vertexShader: waterSurfaceVert(MAXR),
      fragmentShader: waterSurfaceFrag(MAXR),
      uniforms: {
        uTime: { value: 0 },
        uRipA: { value: this.ripA },
        uRipB: { value: this.ripB },
        uRipC: { value: this.ripC },
        uCaustic: { value: 0.35 },
        uSunDirXZ: { value: new THREE.Vector2(0.45, 0.35) },
        uGather: { value: 0 },
        uCamPos: this.camU,
      },
      transparent: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(420, 420, seg, seg), this.mat);
    this.mesh.geometry.rotateX(-Math.PI / 2); // 顶点局部坐标即世界 XZ，位移作用在 Y
    this.mesh.position.set(0, 0, -22);

    // 池底：奶油色细砂 + 流动焦散
    this.bedMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vXZ; varying vec3 vW;
        void main(){ vec4 w=modelMatrix*vec4(position,1.0); vXZ=w.xz; vW=w.xyz;
        gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */ `
        varying vec2 vXZ; varying vec3 vW;
        uniform float uTime; uniform vec3 uCamPos;
        float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
        void main(){
          float d=length(vXZ);
          vec3 base=mix(vec3(0.93,0.84,0.75),vec3(0.82,0.88,0.9),smoothstep(14.0,42.0,d));
          float s=vn(vXZ*3.1)*0.5+vn(vXZ*8.3)*0.3;
          base*=0.85+0.25*s;
          // 焦散光斑（两层交错，稀疏网状）
          float c1=vn(vXZ*1.4+vec2(uTime*0.5,uTime*0.31)+vn(vXZ*1.1+uTime*0.1)*1.2);
          float c2=vn(vXZ*1.7-vec2(uTime*0.37,uTime*0.44)+vn(vXZ*0.9-uTime*0.12)*1.1);
          float ca=pow(max(0.0,c1*c2*2.6-0.55),2.0);
          float fade=exp(-d*0.06);
          base+=vec3(1.0,0.96,0.82)*ca*(0.18+fade*0.5);
          float dist=length(uCamPos-vW);
          base=mix(base,vec3(0.95,0.92,0.87),clamp(1.0-exp(-pow(dist*0.02,1.8)),0.0,0.75));
          gl_FragColor=vec4(base,1.0);
        }`,
      uniforms: { uTime: { value: 0 }, uCamPos: this.camU },
    });
    this.bed = new THREE.Mesh(new THREE.PlaneGeometry(130, 130, 1, 1), this.bedMat);
    this.bed.geometry.rotateX(-Math.PI / 2);
    this.bed.position.set(0, -1.1, -22);
  }

  update(t: number, gather: number, camera: THREE.Camera): void {
    this.camU.value.setFromMatrixPosition(camera.matrixWorld);
    // 水面/池底跟随相机 XZ（涟漪用世界坐标，故仍固定于绝对位置）→ 无限水面错觉
    const cx = this.camU.value.x, cz = this.camU.value.z;
    this.mesh.position.x = cx; this.mesh.position.z = cz;
    this.bed.position.x = cx; this.bed.position.z = cz;
    // 活跃涟漪窗口（按 t0 排序取前 MAXR 个未到期）
    const act = this.events.ripples
      .filter((r) => t >= r.t0 && t - r.t0 < r.life)
      .sort((a, b) => a.t0 - b.t0)
      .slice(0, MAXR);
    for (let i = 0; i < MAXR; i++) {
      const r = act[i];
      if (r) {
        this.ripA[i].set(r.x, r.z, r.t0, r.amp);
        this.ripB[i].set(r.wl, r.sp, r.life, r.wid);
        const pal = PALETTE_RIPPLE[r.col % PALETTE_RIPPLE.length];
        this.ripC[i].set(pal[0], pal[1], pal[2]);
      } else {
        this.ripA[i].set(0, 0, -1, 0); // t0<0 → shader 跳过
      }
    }
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uGather.value = gather;
    // 焦散：开场入水爆发，中段常流，收拢消退
    const imp = this.events.drop.impact;
    const burst = Math.exp(-Math.max(0, t - imp) * 0.55) * (t > imp ? 1.6 : 0);
    const amb = 0.3 + 0.15 * Math.sin(t * 0.5);
    this.mat.uniforms.uCaustic.value = (burst + amb) * (1 - gather);
    this.bedMat.uniforms.uTime.value = t;
  }
}

/** 与 palette.RIPPLE_COLORS 对齐（此处内联避免循环 import 开销） */
import { RIPPLE_COLORS as PALETTE_RIPPLE } from '../core/palette';
