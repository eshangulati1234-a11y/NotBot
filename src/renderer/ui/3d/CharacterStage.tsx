import { View } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import './CharacterStage.css';

/**
 * One transparent canvas laid over the window. Every helper character draws into its own
 * rectangle of it (see HelperMark), so any number of characters share a single 3D context.
 */
export function CharacterStage() {
  return (
    <Canvas
      className="nb-stage"
      flat
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'default' }}
      eventSource={undefined}
      events={undefined}
    >
      <View.Port />
    </Canvas>
  );
}
