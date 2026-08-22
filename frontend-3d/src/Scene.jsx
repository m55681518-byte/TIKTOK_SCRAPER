import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import {
  Float,
  Stars,
  Environment,
  Lightformer,
  MeshDistortMaterial,
} from '@react-three/drei'

const PINK = '#fe2c55'
const CYAN = '#25f4ee'

/* ────────────────────────────────────────────────────────────────────────────
 * Glossy physical material — neon candy look without loading any HDR files
 * (reflections come from the procedural <Environment> Lightformers below).
 * ──────────────────────────────────────────────────────────────────────────── */
function Glossy({ color }) {
  return (
    <meshPhysicalMaterial
      color={color}
      roughness={0.12}
      metalness={0.3}
      clearcoat={1}
      clearcoatRoughness={0.12}
      envMapIntensity={1.5}
    />
  )
}

/* Slow self-rotation on top of <Float> bobbing */
function Spin({ speed = 0.25, children }) {
  const ref = useRef()
  useFrame((_, delta) => {
    ref.current.rotation.y += delta * speed
    ref.current.rotation.x += delta * speed * 0.35
  })
  return <group ref={ref}>{children}</group>
}

/* Parallax rig: drifts & tilts OPPOSITE to the cursor */
function ParallaxGroup({ strength = 1, children }) {
  const ref = useRef()
  useFrame((state, delta) => {
    const { x, y } = state.pointer // -1..1
    const g = ref.current
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, -x * 0.22 * strength, 2.2, delta)
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, y * 0.16 * strength, 2.2, delta)
    g.position.x = THREE.MathUtils.damp(g.position.x, -x * 0.8 * strength, 2.2, delta)
    g.position.y = THREE.MathUtils.damp(g.position.y, y * 0.5 * strength, 2.2, delta)
  })
  return <group ref={ref}>{children}</group>
}

/* Stylised 3D music note built from glossy primitives (head + stem + flag) */
function MusicNote({ color, ...props }) {
  return (
    <group {...props}>
      <mesh scale={[1, 0.78, 1]}>
        <sphereGeometry args={[0.42, 48, 48]} />
        <Glossy color={color} />
      </mesh>
      <mesh position={[0.4, 0.85, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 1.7, 24]} />
        <Glossy color={color} />
      </mesh>
      <mesh position={[0.66, 1.58, 0]} rotation={[0, 0, -0.55]}>
        <boxGeometry args={[0.66, 0.26, 0.12]} />
        <Glossy color={color} />
      </mesh>
    </group>
  )
}

function FloatingObjects({ mobile }) {
  return (
    <ParallaxGroup>
      {/* Fluid neon blob — left */}
      <Float speed={1.4} rotationIntensity={0.5} floatIntensity={1.4}>
        <mesh position={[-3.7, 1.3, -2]} scale={mobile ? 0.8 : 1.15}>
          <sphereGeometry args={[1, 64, 64]} />
          <MeshDistortMaterial
            color={PINK}
            distort={0.42}
            speed={1.6}
            roughness={0.14}
            metalness={0.15}
            envMapIntensity={1.3}
          />
        </mesh>
      </Float>

      {/* Glossy cyan sphere — right */}
      <Float speed={1.8} rotationIntensity={0.4} floatIntensity={1.6}>
        <Spin speed={0.2}>
          <mesh position={[3.5, -1.5, -1.5]} scale={mobile ? 0.65 : 0.95}>
            <sphereGeometry args={[1, 64, 64]} />
            <Glossy color={CYAN} />
          </mesh>
        </Spin>
      </Float>

      {/* Pink torus knot — top right */}
      <Float speed={1.2} rotationIntensity={0.8} floatIntensity={1.1}>
        <Spin speed={0.3}>
          <mesh position={[3.3, 2.3, -3]} scale={mobile ? 0.5 : 0.72}>
            <torusKnotGeometry args={[1, 0.3, 160, 24]} />
            <Glossy color={PINK} />
          </mesh>
        </Spin>
      </Float>

      {/* Cyan music note — bottom left */}
      <Float speed={1.6} rotationIntensity={0.6} floatIntensity={1.3}>
        <Spin speed={0.22}>
          <MusicNote color={CYAN} position={[-3.4, -2.3, -1.2]} scale={mobile ? 0.7 : 1} rotation={[0.2, 0.4, -0.15]} />
        </Spin>
      </Float>

      {!mobile && (
        <>
          {/* Pink music note — far right */}
          <Float speed={1.3} rotationIntensity={0.6} floatIntensity={1.2}>
            <Spin speed={-0.18}>
              <MusicNote color={PINK} position={[4.6, 0.8, -4]} scale={0.8} rotation={[-0.2, -0.5, 0.2]} />
            </Spin>
          </Float>

          {/* Cyan ring — top left */}
          <Float speed={1.5} rotationIntensity={0.9} floatIntensity={1.2}>
            <Spin speed={0.35}>
              <mesh position={[-1.8, 3, -4]}>
                <torusGeometry args={[0.8, 0.22, 32, 80]} />
                <Glossy color={CYAN} />
              </mesh>
            </Spin>
          </Float>

          {/* Small accent spheres */}
          <Float speed={2} floatIntensity={2}>
            <mesh position={[1.6, 3.2, -3]}>
              <sphereGeometry args={[0.28, 32, 32]} />
              <Glossy color={PINK} />
            </mesh>
          </Float>
          <Float speed={2.2} floatIntensity={2}>
            <mesh position={[-4.6, 0.2, -3.5]}>
              <sphereGeometry args={[0.2, 32, 32]} />
              <Glossy color={CYAN} />
            </mesh>
          </Float>
        </>
      )}
    </ParallaxGroup>
  )
}

/* Procedural studio reflections (no network fetch — stays offline-friendly) */
function StudioEnv() {
  return (
    <Environment resolution={64} frames={1}>
      <Lightformer intensity={3} rotation-x={Math.PI / 2} position={[0, 5, 0]} scale={[10, 10, 1]} color="#ffffff" />
      <Lightformer intensity={2.4} rotation-y={Math.PI / 2} position={[-6, 0, 0]} scale={[8, 3, 1]} color={CYAN} />
      <Lightformer intensity={2.4} rotation-y={-Math.PI / 2} position={[6, 0, 0]} scale={[8, 3, 1]} color={PINK} />
      <Lightformer intensity={1.2} position={[0, -4, 0]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} color="#1a1a2e" />
    </Environment>
  )
}

export default function Scene() {
  const mobile = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
    []
  )

  return (
    <Canvas
      dpr={[1, mobile ? 1.5 : 1.75]}
      camera={{ position: [0, 0, 9], fov: 42 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ position: 'fixed', inset: 0, zIndex: 0 }}
      aria-hidden="true"
    >
      <fog attach="fog" args={['#05050a', 9, 24]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 6, 6]} intensity={1.1} />
      <pointLight position={[-6, 2, 4]} intensity={30} color={PINK} />
      <pointLight position={[6, -2, 4]} intensity={26} color={CYAN} />

      <Stars
        radius={60}
        depth={45}
        count={mobile ? 900 : 2400}
        factor={3.4}
        saturation={0}
        fade
        speed={0.7}
      />

      <FloatingObjects mobile={mobile} />
      <StudioEnv />
    </Canvas>
  )
}
