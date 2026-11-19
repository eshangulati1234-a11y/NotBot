import { useMemo } from 'react';
import { CapsuleGeometry, DoubleSide, LatheGeometry, Vector2, type Texture } from 'three';
import type { LookId } from '../looks';
import { Fur } from './Fur';

/** Where each outfit reaches above the body, so the camera can frame the whole character. */
export const outfitTop: Record<LookId, number> = {
  plain: 1.3,
  cowboy: 1.75,
  trooper: 1.4,
  wizard: 2.45,
  astronaut: 1.45,
  chef: 1.95,
  crown: 1.6,
  headphones: 1.35,
  beanie: 1.75,
  bunny: 2.3,
};

interface OutfitProps {
  env: Texture;
  shells: number;
}

const lathe = (points: [number, number][], segments = 64) =>
  new LatheGeometry(points.map(([x, y]) => new Vector2(x, y)), segments);

function Cowboy({ env }: OutfitProps) {
  const brim = useMemo(
    () =>
      lathe([
        [0.42, 0.0],
        [0.8, -0.02],
        [1.08, 0.04],
        [1.24, 0.17],
        [1.26, 0.21],
        [1.1, 0.1],
        [0.8, 0.05],
        [0.42, 0.06],
      ]),
    [],
  );
  const crown = useMemo(
    () =>
      lathe([
        [0.0, 0.58],
        [0.2, 0.56],
        [0.34, 0.5],
        [0.42, 0.34],
        [0.46, 0.06],
      ]),
    [],
  );
  return (
    <group position={[0, 0.84, 0.02]} rotation={[-0.1, 0, 0.04]}>
      <mesh geometry={brim} scale={[0.8, 1, 0.76]}>
        <meshStandardMaterial color="#C58B4B" roughness={0.75} side={DoubleSide} envMap={env} />
      </mesh>
      <mesh geometry={crown} scale={[1.02, 1.35, 1.02]}>
        <meshStandardMaterial color="#D3A465" roughness={0.7} envMap={env} />
      </mesh>
      <mesh position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.47, 0.045, 12, 48]} />
        <meshStandardMaterial color="#5E3517" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.2, 0.52]}>
        <boxGeometry args={[0.13, 0.11, 0.035]} />
        <meshStandardMaterial color="#F0C443" metalness={1} roughness={0.25} envMap={env} />
      </mesh>
    </group>
  );
}

function Trooper({ env }: OutfitProps) {
  const white = { color: '#F7F8FA', roughness: 0.28, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.2, envMap: env };
  return (
    <group position={[0, 0.4, 0.28]}>
      <mesh scale={[1, 1.04, 1.02]}>
        <sphereGeometry args={[0.84, 64, 40, 0, Math.PI * 2, 0, 2.35]} />
        <meshPhysicalMaterial {...white} side={DoubleSide} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.3, 0.05, 0.77]} rotation={[0, side * 0.42, side * -0.3]} scale={[0.2, 0.15, 0.06]}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshPhysicalMaterial color="#0E0E10" roughness={0.12} clearcoat={1} envMap={env} />
        </mesh>
      ))}
      <mesh position={[0, -0.12, 0.84]} rotation={[0.3, 0, 0]}>
        <coneGeometry args={[0.06, 0.15, 3]} />
        <meshStandardMaterial color="#8D979F" roughness={0.5} />
      </mesh>
      <group position={[0, -0.36, 0.78]} rotation={[-0.12, 0, 0]}>
        <mesh>
          <boxGeometry args={[0.34, 0.14, 0.05]} />
          <meshStandardMaterial color="#26262B" roughness={0.45} />
        </mesh>
        {[-0.11, -0.037, 0.037, 0.11].map((x) => (
          <mesh key={x} position={[x, 0, 0.03]}>
            <boxGeometry args={[0.02, 0.11, 0.02]} />
            <meshStandardMaterial color="#F7F8FA" roughness={0.4} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 0.32, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.78, 0.02, 10, 64]} />
        <meshStandardMaterial color="#1B1B1F" roughness={0.5} />
      </mesh>
    </group>
  );
}

function Wizard({ env }: OutfitProps) {
  return (
    <group position={[0, 0.82, 0.02]} rotation={[-0.08, 0, -0.1]}>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[1.12, 1.16, 0.07, 64]} />
        <meshStandardMaterial color="#3A3AA3" roughness={0.8} envMap={env} />
      </mesh>
      <mesh position={[0, 0.78, 0]} rotation={[0, 0, 0.06]}>
        <coneGeometry args={[0.6, 1.55, 48]} />
        <meshStandardMaterial color="#4949BD" roughness={0.75} envMap={env} />
      </mesh>
      <mesh position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.52, 0.065, 12, 48]} />
        <meshStandardMaterial color="#F2C233" metalness={0.9} roughness={0.3} envMap={env} />
      </mesh>
      {[
        [0.0, 0.7, 0.4, 0.09],
        [0.17, 0.46, 0.45, 0.06],
        [-0.15, 0.95, 0.27, 0.05],
      ].map(([x, y, z, s]) => (
        <mesh key={`${x}${y}`} position={[x, y, z]}>
          <octahedronGeometry args={[s, 0]} />
          <meshStandardMaterial color="#FFE27A" emissive="#FFD34D" emissiveIntensity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function Astronaut({ env }: OutfitProps) {
  return (
    <group position={[0, 0.3, 0.1]}>
      <mesh>
        <sphereGeometry args={[1.08, 48, 32]} />
        <meshPhysicalMaterial
          color="#BFE0FF"
          transparent
          opacity={0.2}
          roughness={0.04}
          clearcoat={1}
          envMap={env}
          envMapIntensity={1.6}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, -0.82, -0.05]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.86, 0.11, 16, 48]} />
        <meshStandardMaterial color="#E4E9EE" roughness={0.35} metalness={0.3} envMap={env} />
      </mesh>
      <mesh position={[-0.55, 0.62, 0.7]} rotation={[0, -0.6, 0.6]} scale={[0.3, 0.07, 0.03]}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color="#FFFFFF" transparent opacity={0.7} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Chef({ env }: OutfitProps) {
  const puff = { color: '#FFFFFF', roughness: 0.9, envMap: env };
  return (
    <group position={[0, 0.88, 0]}>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.55, 0.58, 0.3, 40]} />
        <meshStandardMaterial {...puff} />
      </mesh>
      {[
        [0, 0.62, 0, 0.46],
        [-0.42, 0.42, 0, 0.34],
        [0.42, 0.42, 0, 0.34],
        [0, 0.42, 0.4, 0.32],
        [0, 0.42, -0.4, 0.32],
      ].map(([x, y, z, r]) => (
        <mesh key={`${x}${y}${z}`} position={[x, y, z]}>
          <sphereGeometry args={[r, 32, 24]} />
          <meshStandardMaterial {...puff} />
        </mesh>
      ))}
    </group>
  );
}

function Crown({ env }: OutfitProps) {
  const gold = { color: '#F4C93A', metalness: 1, roughness: 0.22, envMap: env };
  return (
    <group position={[0, 0.9, 0.02]} rotation={[-0.08, 0, 0.05]}>
      <mesh position={[0, 0.13, 0]}>
        <cylinderGeometry args={[0.55, 0.52, 0.26, 48, 1, true]} />
        <meshStandardMaterial {...gold} side={DoubleSide} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.sin(a) * 0.5, 0.42, Math.cos(a) * 0.5]}>
            <coneGeometry args={[0.1, 0.34, 4]} />
            <meshStandardMaterial {...gold} />
          </mesh>
        );
      })}
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        return (
          <mesh key={`g${i}`} position={[Math.sin(a) * 0.545, 0.13, Math.cos(a) * 0.545]}>
            <sphereGeometry args={[0.055, 16, 12]} />
            <meshPhysicalMaterial color={i % 2 ? '#3B82F6' : '#E5484D'} roughness={0.1} clearcoat={1} envMap={env} />
          </mesh>
        );
      })}
    </group>
  );
}

function Headphones({ env }: OutfitProps) {
  const shell = { color: '#2E333B', roughness: 0.35, metalness: 0.4, envMap: env };
  return (
    <group position={[0, 0.2, 0]}>
      <mesh>
        <torusGeometry args={[1.04, 0.06, 16, 64, Math.PI]} />
        <meshStandardMaterial {...shell} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 1.04, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <mesh>
            <cylinderGeometry args={[0.3, 0.3, 0.26, 40]} />
            <meshStandardMaterial {...shell} />
          </mesh>
          <mesh position={[0, side * 0.14, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.02, 32]} />
            <meshStandardMaterial color="#0866FF" emissive="#0866FF" emissiveIntensity={0.4} roughness={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Beanie({ env }: OutfitProps) {
  return (
    <group position={[0, 0.5, 0.02]} rotation={[-0.06, 0, 0.05]}>
      <mesh scale={[1, 0.78, 1]}>
        <sphereGeometry args={[1.0, 48, 32, 0, Math.PI * 2, 0, 1.2]} />
        <meshStandardMaterial color="#E5484D" roughness={0.95} side={DoubleSide} envMap={env} />
      </mesh>
      <mesh position={[0, 0.26, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.93, 0.13, 16, 64]} />
        <meshStandardMaterial color="#F0646A" roughness={0.95} envMap={env} />
      </mesh>
      <mesh position={[0, 0.9, 0]}>
        <sphereGeometry args={[0.24, 24, 18]} />
        <meshStandardMaterial color="#FFFFFF" roughness={1} />
      </mesh>
    </group>
  );
}

function Bunny({ fur, root, shells }: OutfitProps & { fur: string; root: string }) {
  const ear = useMemo(() => new CapsuleGeometry(0.17, 0.78, 8, 20), []);
  return (
    <group position={[0, 0.9, 0]}>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.42, 0.5, -0.02]} rotation={[0, 0, side * -0.2]}>
          <Fur geometry={ear} color={fur} root={root} shells={Math.round(shells * 0.7)} length={0.07} density={[60, 90]} />
          <mesh position={[0, 0.02, 0.1]} scale={[0.62, 0.8, 0.4]}>
            <capsuleGeometry args={[0.17, 0.78, 8, 20]} />
            <meshStandardMaterial color="#F6B8C0" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Outfit({ look, env, shells, fur, root }: OutfitProps & { look: LookId; fur: string; root: string }) {
  switch (look) {
    case 'cowboy':
      return <Cowboy env={env} shells={shells} />;
    case 'trooper':
      return <Trooper env={env} shells={shells} />;
    case 'wizard':
      return <Wizard env={env} shells={shells} />;
    case 'astronaut':
      return <Astronaut env={env} shells={shells} />;
    case 'chef':
      return <Chef env={env} shells={shells} />;
    case 'crown':
      return <Crown env={env} shells={shells} />;
    case 'headphones':
      return <Headphones env={env} shells={shells} />;
    case 'beanie':
      return <Beanie env={env} shells={shells} />;
    case 'bunny':
      return <Bunny env={env} shells={shells} fur={fur} root={root} />;
    default:
      return null;
  }
}
