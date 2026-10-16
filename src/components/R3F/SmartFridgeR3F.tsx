import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, RoundedBox, ContactShadows, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useFridgeStore } from '../../App';

/**
 * Component 3D sử dụng React Three Fiber (@react-three/fiber) & @react-three/drei
 */
export function SmartFridgeR3FModel() {
  const {
    temperature,
    doorLeftOpen,
    doorRightOpen,
    cooling,
    buzzer,
    toggleLeftDoor,
    toggleRightDoor
  } = useFridgeStore();

  const leftDoorPivotRef = useRef<THREE.Group>(null);
  const rightDoorPivotRef = useRef<THREE.Group>(null);
  const fanBladesRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);

  const anyDoorOpen = doorLeftOpen || doorRightOpen;

  const particlePositions = useMemo(() => {
    const arr = new Float32Array(120 * 3);
    for (let i = 0; i < 120; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 0.75;
      arr[i * 3 + 1] = 0.2 + Math.random() * 1.35;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 0.45;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    if (leftDoorPivotRef.current) {
      const targetLeft = doorLeftOpen ? -Math.PI * 0.62 : 0;
      leftDoorPivotRef.current.rotation.y = THREE.MathUtils.lerp(
        leftDoorPivotRef.current.rotation.y,
        targetLeft,
        delta * 6
      );
    }
    if (rightDoorPivotRef.current) {
      const targetRight = doorRightOpen ? Math.PI * 0.62 : 0;
      rightDoorPivotRef.current.rotation.y = THREE.MathUtils.lerp(
        rightDoorPivotRef.current.rotation.y,
        targetRight,
        delta * 6
      );
    }
    if (fanBladesRef.current && cooling) {
      fanBladesRef.current.rotation.z -= delta * 14;
    }
    if (particlesRef.current && cooling) {
      const pos = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - delta * 0.55;
        if (y < 0.2) y = 1.55;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      <RoundedBox args={[1.04, 1.88, 0.72]} position={[0, 0.94, 0]} radius={0.02} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color="#8a929a" metalness={0.78} roughness={0.26} />
      </RoundedBox>

      <pointLight
        position={[0, 1.68, 0.12]}
        intensity={anyDoorOpen ? 2.2 : 0}
        distance={2.5}
        color="#e0f2fe"
      />

      {/* Hệ thống quạt làm lạnh 3D */}
      <group position={[0, 1.45, -0.25]}>
        <group ref={fanBladesRef}>
          {[0, 1, 2, 3, 4, 5].map((idx) => (
            <mesh key={idx} rotation={[0, 0, (idx * Math.PI) / 3]}>
              <boxGeometry args={[0.22, 0.035, 0.01]} />
              <meshStandardMaterial
                color={cooling ? '#38bdf8' : '#64748b'}
                emissive={cooling ? '#0284c7' : '#000000'}
                emissiveIntensity={cooling ? 0.5 : 0}
              />
            </mesh>
          ))}
        </group>
      </group>

      {/* Hạt luồng khí lạnh */}
      {cooling && (
        <points ref={particlesRef}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={particlePositions.length / 3}
              array={particlePositions}
              itemSize={3}
            />
          </bufferGeometry>
          <pointsMaterial color="#7dd3fc" size={0.025} transparent opacity={0.65} />
        </points>
      )}

      {/* Cánh cửa Trái */}
      <group ref={leftDoorPivotRef} position={[-0.51, 0.945, 0.36]}>
        <group
          position={[0.25, 0, 0.024]}
          onClick={(e) => {
            e.stopPropagation();
            toggleLeftDoor();
          }}
        >
          <RoundedBox args={[0.50, 1.75, 0.048]} radius={0.012} smoothness={4} castShadow>
            <meshStandardMaterial color="#9aa1a9" metalness={0.82} roughness={0.22} />
          </RoundedBox>
        </group>
      </group>

      {/* Cánh cửa Phải + Màn hình nhiệt độ kỹ thuật số */}
      <group ref={rightDoorPivotRef} position={[0.51, 0.945, 0.36]}>
        <group
          position={[-0.25, 0, 0.024]}
          onClick={(e) => {
            e.stopPropagation();
            toggleRightDoor();
          }}
        >
          <RoundedBox args={[0.50, 1.75, 0.048]} radius={0.012} smoothness={4} castShadow>
            <meshStandardMaterial color="#9aa1a9" metalness={0.82} roughness={0.22} />
          </RoundedBox>
          <Text
            position={[0.02, 0.32, 0.028]}
            fontSize={0.055}
            color={buzzer ? '#f87171' : cooling ? '#38bdf8' : '#34d399'}
            anchorX="center"
            anchorY="middle"
          >
            {`${temperature.toFixed(1)}°C`}
          </Text>
        </group>
      </group>
    </group>
  );
}

export const SmartFridgeR3FCanvas: React.FC = () => (
  <Canvas shadows camera={{ position: [1.8, 1.5, 2.6], fov: 42 }}>
    <color attach="background" args={['#0b0d13']} />
    <ambientLight intensity={0.45} />
    <directionalLight position={[3, 5, 3]} intensity={1.2} castShadow />
    <SmartFridgeR3FModel />
    <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={6} blur={2} far={4} />
    <OrbitControls
      target={[0, 0.96, 0]}
      enableDamping
      dampingFactor={0.06}
      minDistance={1.35}
      maxDistance={4.5}
      minPolarAngle={0.3}
      maxPolarAngle={Math.PI / 2 - 0.04}
    />
  </Canvas>
);
