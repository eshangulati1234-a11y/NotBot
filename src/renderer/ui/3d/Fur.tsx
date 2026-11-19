import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, DoubleSide, InstancedMesh, ShaderMaterial, type BufferGeometry } from 'three';

const vertex = /* glsl */ `
  uniform float uLen;
  uniform float uShells;
  uniform vec3 uGravity;
  varying vec2 vUv;
  varying float vLayer;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vLayer = float(gl_InstanceID) / (uShells - 1.0);
    vUv = uv;
    vec3 p = position + normal * uLen * vLayer + uGravity * vLayer * vLayer;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uRoot;
  uniform vec3 uTip;
  uniform vec2 uDensity;
  varying vec2 vUv;
  varying float vLayer;
  varying vec3 vNormal;
  varying vec3 vView;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 g = vUv * uDensity;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    f -= (vec2(hash(id + 1.7), hash(id + 9.1)) - 0.5) * 0.42;
    float h = hash(id);
    float reach = 0.55 + 0.45 * h;
    float radius = 0.6 * (1.0 - 0.5 * pow(vLayer / reach, 2.0));
    float alpha = 1.0;
    if (vLayer > 0.001) {
      alpha = clamp((radius - length(f)) / 0.4, 0.0, 1.0) * step(vLayer, reach);
      if (alpha <= 0.01) discard;
    }
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    vec3 key = normalize(vec3(-0.45, 0.8, 0.6));
    float wrap = clamp((dot(n, key) + 0.35) / 1.35, 0.0, 1.0);
    float below = clamp(0.5 - 0.5 * n.y, 0.0, 1.0);
    float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.6);
    vec3 base = mix(uRoot, uTip, smoothstep(0.0, 1.0, vLayer));
    float shade = mix(0.66, 1.0, smoothstep(0.0, 0.85, vLayer)) * (0.7 + 0.5 * wrap) * (1.0 - 0.16 * below);
    vec3 col = base * shade * (1.0 - rim * 0.18) + (h - 0.5) * 0.04;
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

interface FurProps {
  geometry: BufferGeometry;
  /** Main fur colour, a CSS hex string. */
  color: string;
  /** Darker colour at the roots, a CSS hex string. */
  root: string;
  /** How many layers to draw; fewer is cheaper and looks fine at small sizes. */
  shells?: number;
  length?: number;
  density?: [number, number];
  gravity?: [number, number, number];
}

/** Fur drawn as stacked shells, each pushed a little further out, with strands cut from noise. */
export function Fur({
  geometry,
  color,
  root,
  shells = 30,
  length = 0.1,
  density = [150, 80],
  gravity = [0, -0.035, 0],
}: FurProps) {
  const mesh = useRef<InstancedMesh>(null);
  const material = useMemo(() => {
    const m = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      side: DoubleSide,
      alphaToCoverage: true,
      uniforms: {
        uLen: { value: length },
        uShells: { value: shells },
        uGravity: { value: gravity },
        uRoot: { value: new Color(root) },
        uTip: { value: new Color(color) },
        uDensity: { value: density },
      },
    });
    return m;
    // The material is rebuilt only when the shell count changes; colours are updated below.
  }, [shells]);

  useLayoutEffect(() => {
    material.uniforms.uLen.value = length;
    material.uniforms.uGravity.value = gravity;
    material.uniforms.uDensity.value = density;
    (material.uniforms.uRoot.value as Color).set(root);
    (material.uniforms.uTip.value as Color).set(color);
  }, [material, color, root, length, density, gravity]);

  useLayoutEffect(() => () => material.dispose(), [material]);

  return <instancedMesh ref={mesh} args={[geometry, material, shells]} frustumCulled={false} />;
}
