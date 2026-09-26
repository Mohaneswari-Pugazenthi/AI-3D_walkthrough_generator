import { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { BlueprintData } from '@/lib/blueprintAnalyzer';
import type { PathNode } from '@/lib/pathfinding';

const WALL_HEIGHT = 3;
const SCALE = 0.2; // scale grid units to 3D units

interface SceneContentProps {
  blueprint: BlueprintData;
  path: PathNode[];
}

/** Individual wall segment as a 3D box */
function WallSegment({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const width = Math.max(w * SCALE, 0.15);
  const depth = Math.max(h * SCALE, 0.15);
  return (
    <mesh position={[x * SCALE + width / 2, WALL_HEIGHT / 2, y * SCALE + depth / 2]}>
      <boxGeometry args={[width, WALL_HEIGHT, depth]} />
      <meshStandardMaterial color="#111827" roughness={0.4} />
    </mesh>
  );
}

/** Floor plane */
function Floor({ width, height }: { width: number; height: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[width * SCALE / 2, 0, height * SCALE / 2]}>
      <planeGeometry args={[width * SCALE, height * SCALE]} />
      <meshStandardMaterial color="#e2e8f0" side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Room floor highlight with center dot marker */
function RoomFloor({ room, gridScale }: { room: BlueprintData['rooms'][0]; gridScale: number }) {
  const w = (room.bounds.maxX - room.bounds.minX) * SCALE;
  const h = (room.bounds.maxY - room.bounds.minY) * SCALE;
  const cx = (room.bounds.minX + (room.bounds.maxX - room.bounds.minX) / 2) * SCALE;
  const cz = (room.bounds.minY + (room.bounds.maxY - room.bounds.minY) / 2) * SCALE;

  // Calculate proportional small font size so labels fit inside room bounds
  const labelFontSize = Math.min(0.25, Math.max(0.14, Math.min(w, h) * 0.15));

  return (
    <group>
      {/* Distinct Room Color Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.02, cz]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color={room.color} side={THREE.DoubleSide} roughness={0.6} />
      </mesh>

      {/* Center Color Dot Marker (Matching Reference Image 1) */}
      <mesh position={[cx, 0.12, cz]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color={room.borderColor || '#3b82f6'} roughness={0.2} />
      </mesh>

      {/* Sleek, minimized 3D text label */}
      <Text
        position={[cx, WALL_HEIGHT + 0.2, cz]}
        fontSize={labelFontSize}
        maxWidth={Math.max(w * 0.85, 0.5)}
        color="#0f172a"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="#ffffff"
        font={undefined}
      >
        {room.name}
      </Text>
    </group>
  );
}

/** 3D path visualization */
function PathLine({ path }: { path: PathNode[] }) {
  const points = useMemo(() => {
    if (path.length < 2) return [];
    return path.map(p => new THREE.Vector3(p.x * SCALE, 0.15, p.y * SCALE));
  }, [path]);

  if (points.length < 2) return null;

  return (
    <>
      <Line
        points={points}
        color="#1a1a1a"
        lineWidth={4}
      />
      {/* Start marker */}
      <mesh position={[points[0].x, 0.3, points[0].z]}>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshStandardMaterial color="#333" />
      </mesh>
      {/* End marker */}
      <mesh position={[points[points.length - 1].x, 0.3, points[points.length - 1].z]}>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshStandardMaterial color="#666" />
      </mesh>
    </>
  );
}

/** Walls rendered from grid data */
function GridWalls({ grid }: { grid: number[][] }) {
  const walls = useMemo(() => {
    const segments: { x: number; y: number; w: number; h: number }[] = [];
    const h = grid.length;
    const w = grid[0]?.length || 0;
    const visited = Array.from({ length: h }, () => new Uint8Array(w));

    // Merge horizontal runs
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (grid[y][x] === 1 && !visited[y][x]) {
          let endX = x;
          while (endX < w && grid[y][endX] === 1 && !visited[y][endX]) {
            visited[y][endX] = 1;
            endX++;
          }
          segments.push({ x, y, w: endX - x, h: 1 });
        }
      }
    }
    return segments;
  }, [grid]);

  return (
    <>
      {walls.map((seg, i) => (
        <WallSegment key={i} {...seg} />
      ))}
    </>
  );
}

function SceneContent({ blueprint, path }: SceneContentProps) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 15, 10]} intensity={0.8} />
      <Floor width={blueprint.width} height={blueprint.height} />
      <GridWalls grid={blueprint.grid} />
      {blueprint.rooms.map(room => (
        <RoomFloor key={room.id} room={room} gridScale={blueprint.gridScale} />
      ))}
      <PathLine path={path} />
      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        maxPolarAngle={Math.PI / 2.1}
        target={[
          (blueprint.width * SCALE) / 2,
          0,
          (blueprint.height * SCALE) / 2,
        ]}
      />
    </>
  );
}

interface Scene3DProps {
  blueprint: BlueprintData;
  path: PathNode[];
}

export default function Scene3D({ blueprint, path }: Scene3DProps) {
  const cameraPos = useMemo<[number, number, number]>(() => {
    const cx = (blueprint.width * SCALE) / 2;
    const cz = (blueprint.height * SCALE) / 2;
    return [cx, 15, cz + 12];
  }, [blueprint]);

  return (
    <div className="w-full h-full bg-muted rounded-lg overflow-hidden border border-border">
      <Canvas camera={{ position: cameraPos, fov: 50, near: 0.1, far: 200 }}>
        <SceneContent
          blueprint={blueprint}
          path={path}
        />
      </Canvas>
    </div>
  );
}
