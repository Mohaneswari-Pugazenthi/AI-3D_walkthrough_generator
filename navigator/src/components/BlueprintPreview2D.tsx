import { useRef, useEffect } from 'react';
import type { BlueprintData } from '@/lib/blueprintAnalyzer';
import type { PathNode } from '@/lib/pathfinding';

interface BlueprintPreview2DProps {
  blueprint: BlueprintData;
  path: PathNode[];
}

export default function BlueprintPreview2D({ blueprint, path }: BlueprintPreview2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const scale = 6;
    canvas.width = blueprint.width * scale;
    canvas.height = blueprint.height * scale;

    // Background
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Room fills
    for (const room of blueprint.rooms) {
      ctx.fillStyle = room.color;
      ctx.fillRect(
        room.bounds.minX * scale,
        room.bounds.minY * scale,
        (room.bounds.maxX - room.bounds.minX) * scale,
        (room.bounds.maxY - room.bounds.minY) * scale
      );

      // Room Center Dot Marker (Matching Reference Image 1)
      ctx.fillStyle = room.borderColor || '#3b82f6';
      ctx.beginPath();
      ctx.arc(room.centerX * scale, room.centerY * scale, 4, 0, Math.PI * 2);
      ctx.fill();

      // Room label
      const roomWidth = (room.bounds.maxX - room.bounds.minX) * scale;
      const roomHeight = (room.bounds.maxY - room.bounds.minY) * scale;
      const fontSize = Math.min(12, Math.max(9, Math.min(roomWidth, roomHeight) * 0.18));
      
      ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // Text stroke halo for crisp legibility
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.strokeText(room.name, room.centerX * scale, (room.centerY * scale) - fontSize * 1.2);
      
      ctx.fillStyle = '#0f172a';
      ctx.fillText(room.name, room.centerX * scale, (room.centerY * scale) - fontSize * 1.2);
    }

    // Walls (grid)
    ctx.fillStyle = '#1a1a1a';
    for (let y = 0; y < blueprint.height; y++) {
      for (let x = 0; x < blueprint.width; x++) {
        if (blueprint.grid[y]?.[x] === 1) {
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }

    // Path overlay
    if (path.length > 1) {
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(path[0].x * scale, path[0].y * scale);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x * scale, path[i].y * scale);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Start/end dots
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(path[0].x * scale, path[0].y * scale, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(path[path.length - 1].x * scale, path[path.length - 1].y * scale, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [blueprint, path]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-auto border border-border rounded-lg"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
