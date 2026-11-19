import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import { Color, LatheGeometry, MathUtils, SphereGeometry, Vector2, type Group, type Mesh } from 'three';
import { TINTS, type Look } from '../looks';
import { poses, type CharState, type Pose } from '../../lib/charState';
import { Fur } from './Fur';
import { Outfit, outfitTop } from './outfits';
import { shadowTexture, useEnv } from './env';

const BOTTOM = -1.18;
const FOV = 26;

const smooth = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

function bodyGeometry() {
  const points: Vector2[] = [];
  const steps = 56;
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI;
    const y = -1.0 + 2.1 * ((1 - Math.cos(a)) / 2);
    const ty = (y + 1) / 2.1;
    const r = 0.98 * Math.pow(Math.sin(a), 0.62) * (1 - 0.22 * ty);
    points.push(new Vector2(r, y));
  }
  return new LatheGeometry(points, 96);
}

interface PlushProps {
  look: Look;
  state: CharState;
  shells: number;
  seed: number;
  still: boolean;
}

function Plush({ look, state, shells, seed, still }: PlushProps) {
  const tint = TINTS.find((item) => item.id === look.tint) ?? TINTS[0];
  const env = useEnv();
  const body = useMemo(bodyGeometry, []);
  const arm = useMemo(() => new SphereGeometry(0.21, 32, 24), []);
  const foot = useMemo(() => new SphereGeometry(0.24, 28, 20), []);

  const rig = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const pupilL = useRef<Group>(null);
  const pupilR = useRef<Group>(null);
  const mouth = useRef<Mesh>(null);
  const browL = useRef<Mesh>(null);
  const browR = useRef<Mesh>(null);
  const dots = useRef<Group>(null);
  const sparks = useRef<Group>(null);
  const cur = useRef<Pose>({ ...poses[state] });
  const target = useRef<CharState>(state);
  target.current = state;

  useEffect(() => {
    if (still) cur.current = { ...poses[state] };
  }, [still, state]);

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = still ? 0 : frame.clock.elapsedTime + seed * 17;
    const want = poses[target.current];
    const k = smooth(dt, 7);
    const p = cur.current;
    (Object.keys(want) as (keyof Pose)[]).forEach((key) => {
      p[key] += (want[key] - p[key]) * k;
    });

    const live = target.current;
    // Procedural motion layered on top of the pose.
    const breathe = Math.sin(t * 1.7) * 0.012;
    const hop = Math.abs(Math.sin(t * (live === 'done' ? 6 : 3.2))) * p.bounce * (live === 'done' ? 0.28 : 0.06);
    const squash = live === 'done' ? 1 - Math.max(0, 0.08 - hop * 0.3) : 1;
    const scan = live === 'reading' ? Math.sin(t * 2.4) * 0.8 : 0;
    const sway = live === 'waiting' ? Math.sin(t * 1.5) * 0.05 : live === 'thinking' ? Math.sin(t * 1.1) * 0.03 : 0;
    const scribble = live === 'writing' ? Math.sin(t * 11) * 0.09 : 0;
    const droop = live === 'error' ? -0.05 : 0;

    if (rig.current) {
      rig.current.position.y = hop + droop;
      rig.current.rotation.z = p.tilt + sway;
      rig.current.rotation.x = p.lean * 0.18;
      rig.current.scale.set(1 + breathe * 0.5, squash + breathe, 1 + breathe * 0.5);
    }

    const blinkPhase = (t + seed * 3.1) % 4.3;
    const blink = blinkPhase < 0.14 ? Math.abs(Math.cos((blinkPhase / 0.14) * Math.PI * 0.5)) * 0.92 + 0.08 : 1;
    if (eyes.current) eyes.current.scale.y = Math.max(0.06, p.eyes * blink);
    const lx = (p.lookX + scan) * 0.03;
    const ly = p.lookY * 0.025;
    for (const pupil of [pupilL.current, pupilR.current]) pupil?.position.set(lx, ly, 0);

    if (mouth.current) {
      const s = p.smile;
      mouth.current.scale.set(1 + Math.abs(s) * 0.15, Math.max(0.12, Math.abs(s)), 1);
      mouth.current.rotation.z = s >= 0 ? Math.PI : 0;
      mouth.current.position.y = -0.1 + (s >= 0 ? 0.045 : -0.045) * Math.abs(s);
    }
    const brow = p.brow;
    for (const [mesh, side] of [
      [browL.current, -1],
      [browR.current, 1],
    ] as const) {
      if (!mesh) continue;
      mesh.rotation.z = side * -brow * 0.5;
      mesh.position.y = 0.55 + Math.abs(brow) * 0.025 + (brow > 0 && side === 1 ? 0.03 : 0);
      mesh.scale.x = MathUtils.clamp(Math.abs(brow) * 1.6, 0, 1);
    }

    const angle = (raise: number, extra: number) => 0.18 + MathUtils.clamp(raise, -0.2, 1) * 1.55 + extra;
    if (armL.current) armL.current.rotation.z = -angle(p.armL, live === 'done' ? Math.sin(t * 6) * 0.14 : 0);
    if (armR.current) armR.current.rotation.z = angle(p.armR, live === 'done' ? -Math.sin(t * 6) * 0.14 : scribble);

    if (dots.current) {
      dots.current.visible = live === 'thinking';
      dots.current.children.forEach((child, i) => {
        const pulse = 0.55 + 0.45 * Math.sin(t * 4 - i * 1.1);
        child.scale.setScalar(0.6 + pulse * 0.7);
      });
    }
    if (sparks.current) {
      sparks.current.visible = live === 'done';
      sparks.current.rotation.y = t * 1.6;
      sparks.current.children.forEach((child, i) => {
        child.scale.setScalar(0.7 + 0.5 * Math.abs(Math.sin(t * 5 + i * 2)));
      });
    }
  });

  const fur = tint.fur;
  const root = useMemo(() => new Color(tint.shade).lerp(new Color(tint.fur), 0.55).getStyle(), [tint]);
  const small = Math.round(shells * 0.7);
  const lids = '#1B1210';

  return (
    <group ref={rig}>
      <Fur geometry={body} color={fur} root={root} shells={shells} length={0.075} density={[230, 135]} />
      {[-1, 1].map((side) => (
        <group key={side} ref={side < 0 ? armL : armR} position={[side * 0.86, 0.08, 0.06]}>
          <group position={[0, -0.3, 0]} scale={[0.72, 1.4, 0.8]}>
            <Fur geometry={arm} color={fur} root={root} shells={small} length={0.06} density={[110, 70]} />
          </group>
        </group>
      ))}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.4, -0.98, 0.34]} scale={[1, 0.62, 1.2]}>
          <Fur geometry={foot} color={fur} root={root} shells={Math.round(shells * 0.5)} length={0.05} density={[110, 70]} />
        </group>
      ))}

      <group position={[0, 0.33, 0.6]}>
        <mesh scale={[0.6, 0.53, 0.4]}>
          <sphereGeometry args={[1, 64, 48]} />
          <meshPhysicalMaterial color={tint.face} roughness={0.85} sheen={1} sheenColor="#FFFFFF" sheenRoughness={0.5} envMap={env} envMapIntensity={0.5} />
        </mesh>
        <group ref={eyes} position={[0, 0.07, 0.34]}>
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.21, 0, side === -1 ? 0 : 0]}>
              <group ref={side < 0 ? pupilL : pupilR}>
                <mesh scale={[1, 1.18, 0.9]}>
                  <sphereGeometry args={[0.088, 32, 24]} />
                  <meshPhysicalMaterial color={lids} roughness={0.12} clearcoat={1} clearcoatRoughness={0.05} envMap={env} envMapIntensity={1.4} />
                </mesh>
                <mesh position={[0.026, 0.04, 0.072]}>
                  <sphereGeometry args={[0.024, 12, 10]} />
                  <meshBasicMaterial color="#FFFFFF" />
                </mesh>
              </group>
            </group>
          ))}
        </group>
        {[-1, 1].map((side) => (
          <mesh key={side} ref={side < 0 ? browL : browR} position={[side * 0.21, 0.55 - 0.33, 0.36]} scale={[0, 1, 1]}>
            <capsuleGeometry args={[0.012, 0.1, 4, 8]} />
            <meshStandardMaterial color="#6B4B3A" roughness={0.9} />
          </mesh>
        ))}
        <mesh ref={mouth} position={[0, -0.13, 0.385]} rotation={[0, 0, Math.PI]}>
          <torusGeometry args={[0.085, 0.015, 10, 32, Math.PI]} />
          <meshStandardMaterial color={lids} roughness={0.5} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.37, -0.09, 0.3]} rotation={[0, side * 0.7, 0]} scale={[0.11, 0.075, 0.02]}>
            <sphereGeometry args={[1, 24, 16]} />
            <meshBasicMaterial color="#F4929A" transparent opacity={0.5} depthWrite={false} />
          </mesh>
        ))}
      </group>

      <Outfit look={look.look} env={env} shells={shells} fur={fur} root={root} />

      <group ref={dots} visible={false} position={[0.78, 1.4, 0.2]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[i * 0.2, i * 0.12, 0]}>
            <sphereGeometry args={[0.07, 16, 12]} />
            <meshStandardMaterial color="#FFFFFF" emissive="#FFFFFF" emissiveIntensity={0.35} roughness={0.5} />
          </mesh>
        ))}
      </group>
      <group ref={sparks} visible={false} position={[0, 0.6, 0]}>
        {[
          [1.35, 1.1],
          [-1.35, 1.25],
          [1.1, -0.2],
          [-1.15, -0.1],
        ].map(([x, y], i) => (
          <mesh key={i} position={[x, y, 0.2]}>
            <octahedronGeometry args={[0.09, 0]} />
            <meshStandardMaterial color="#FFE27A" emissive="#FFD34D" emissiveIntensity={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export interface PlushSceneProps {
  look: Look;
  state: CharState;
  /** Pixel size of the view, used to choose how detailed the fur is. */
  size: number;
  seed: number;
  still: boolean;
}

/** One character with its own camera, lights and soft shadow, framed to fit its outfit. */
export function PlushScene({ look, state, size, seed, still }: PlushSceneProps) {
  const top = outfitTop[look.look];
  const span = top - BOTTOM + 0.25;
  const centre = (top + BOTTOM) / 2;
  const distance = (span / 2 / Math.tan((FOV * Math.PI) / 360)) * 1.04;
  const shells = size >= 100 ? 34 : size >= 56 ? 26 : 18;
  return (
    <>
      <PerspectiveCamera makeDefault fov={FOV} position={[0, centre, distance]} near={0.5} far={40} onUpdate={(c) => c.lookAt(0, centre, 0)} />
      <ambientLight intensity={0.85} />
      <hemisphereLight args={['#ffffff', '#cdb9a2', 0.7]} />
      <directionalLight position={[-3, 5, 5]} intensity={1.7} />
      <directionalLight position={[4, 2, -3]} intensity={0.8} color="#cfe0ff" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, BOTTOM + 0.04, 0.1]} scale={[2.9, 2.2, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={shadowTexture()} transparent depthWrite={false} />
      </mesh>
      <Plush look={look} state={state} shells={shells} seed={seed} still={still} />
    </>
  );
}
