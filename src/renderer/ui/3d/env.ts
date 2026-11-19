import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { CanvasTexture, PMREMGenerator, RepeatWrapping, type Texture, type WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const envs = new WeakMap<WebGLRenderer, Texture>();

/** Soft studio reflections for glossy and metal parts, built once per renderer without any network. */
export function useEnv(): Texture {
  const gl = useThree((state) => state.gl);
  return useMemo(() => {
    let texture = envs.get(gl);
    if (!texture) {
      const generator = new PMREMGenerator(gl);
      texture = generator.fromScene(new RoomEnvironment(), 0.04).texture;
      generator.dispose();
      envs.set(gl, texture);
    }
    return texture;
  }, [gl]);
}

let shadow: CanvasTexture | null = null;

/** A soft dark blob that sits under the character, drawn once and shared. */
export function shadowTexture(): CanvasTexture {
  if (shadow) return shadow;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(0,0,0,0.38)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.14)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }
  shadow = new CanvasTexture(canvas);
  shadow.wrapS = shadow.wrapT = RepeatWrapping;
  return shadow;
}
