/**
 * Blueprint Analyzer - Client-side image processing for floor plan analysis.
 * Uses Canvas API to simulate OpenCV operations:
 * - Adaptive thresholding
 * - Morphological operations (erosion, dilation, opening, closing)
 * - Edge detection
 * - Contour/room detection via flood fill
 * - Wall segment extraction & 3D space conversion
 */

export interface Wall {
  x1: number; y1: number;
  x2: number; y2: number;
}

export interface Room {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;
  color: string;
  borderColor: string;
}

export interface BlueprintData {
  walls: Wall[];
  rooms: Room[];
  grid: number[][];
  width: number;
  height: number;
  gridScale: number;
}

export const ROOM_PALETTE = [
  { color: '#D3C6A6', borderColor: '#B59851' }, // Ochre / Beige
  { color: '#93B2D6', borderColor: '#4A88D9' }, // Soft Steel Blue
  { color: '#82C4B7', borderColor: '#3CAEA3' }, // Soft Teal
  { color: '#A3D69B', borderColor: '#55B946' }, // Sage Green
  { color: '#E6A8A8', borderColor: '#E05A5A' }, // Dusty Rose
  { color: '#C8A8E6', borderColor: '#9A5AE0' }, // Soft Lavender
  { color: '#F4B993', borderColor: '#E07A3B' }, // Warm Coral
  { color: '#96E0D2', borderColor: '#2CB39B' }, // Mint Cyan
  { color: '#F0D496', borderColor: '#D9A436' }, // Sunny Amber
  { color: '#C7E6A8', borderColor: '#7BB836' }, // Light Olive Green
];

/**
 * Get pixel data from an image on a canvas
 */
function getImageData(img: HTMLImageElement, targetWidth: number, targetHeight: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  return ctx.getImageData(0, 0, targetWidth, targetHeight);
}

/**
 * Convert to grayscale
 */
function toGrayscale(data: ImageData): Uint8Array {
  const gray = new Uint8Array(data.width * data.height);
  for (let i = 0; i < gray.length; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * data.data[idx] + 0.587 * data.data[idx + 1] + 0.114 * data.data[idx + 2]);
  }
  return gray;
}

/**
 * Morphological Erosion (min filter)
 */
export function morphErode(src: Uint8Array, w: number, h: number, kernelSize: number): Uint8Array {
  const dst = new Uint8Array(w * h);
  const r = Math.floor(kernelSize / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let minVal = 255;
      for (let ky = -r; ky <= r; ky++) {
        const ny = y + ky;
        if (ny < 0 || ny >= h) continue;
        for (let kx = -r; kx <= r; kx++) {
          const nx = x + kx;
          if (nx < 0 || nx >= w) continue;
          const val = src[ny * w + nx];
          if (val < minVal) minVal = val;
        }
      }
      dst[y * w + x] = minVal;
    }
  }
  return dst;
}

/**
 * Morphological Dilation (max filter)
 */
export function morphDilate(src: Uint8Array, w: number, h: number, kernelSize: number): Uint8Array {
  const dst = new Uint8Array(w * h);
  const r = Math.floor(kernelSize / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let maxVal = 0;
      for (let ky = -r; ky <= r; ky++) {
        const ny = y + ky;
        if (ny < 0 || ny >= h) continue;
        for (let kx = -r; kx <= r; kx++) {
          const nx = x + kx;
          if (nx < 0 || nx >= w) continue;
          const val = src[ny * w + nx];
          if (val > maxVal) maxVal = val;
        }
      }
      dst[y * w + x] = maxVal;
    }
  }
  return dst;
}

/**
 * Morphological Closing (Dilation then Erosion) - closes wall/door gaps
 */
export function morphClose(src: Uint8Array, w: number, h: number, kernelSize: number): Uint8Array {
  const dilated = morphDilate(src, w, h, kernelSize);
  return morphErode(dilated, w, h, kernelSize);
}

/**
 * Morphological Opening (Erosion then Dilation) - removes isolated noise
 */
export function morphOpen(src: Uint8Array, w: number, h: number, kernelSize: number): Uint8Array {
  const eroded = morphErode(src, w, h, kernelSize);
  return morphDilate(eroded, w, h, kernelSize);
}

/**
 * Extract Wall Segments for 3D Mesh rendering
 */
export function extractWalls(binary: Uint8Array, w: number, h: number, scale: number): Wall[] {
  const walls: Wall[] = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (binary[y * w + x] === 255) {
        const startX = x;
        while (x < w && binary[y * w + x] === 255) x++;
        if (x - startX > 1) {
          walls.push({
            x1: startX * scale,
            y1: y * scale,
            x2: x * scale,
            y2: y * scale,
          });
        }
      } else {
        x++;
      }
    }
  }
  return walls;
}

/**
 * Adaptive contrast & Otsu hybrid thresholding to isolate structural walls
 * Handles BW CAD drawings, textured 3D floor plans, and camera photos of blueprints.
 */
function smartWallDetection(gray: Uint8Array, w: number, h: number): Uint8Array {
  const binary = new Uint8Array(w * h);
  const halfBlock = 7;

  // Compute integral image for fast local mean and variance
  const integral = new Float64Array((w + 1) * (h + 1));
  const integralSq = new Float64Array((w + 1) * (h + 1));

  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSumSq = 0;
    for (let x = 0; x < w; x++) {
      const val = gray[y * w + x];
      rowSum += val;
      rowSumSq += val * val;
      const idx = (y + 1) * (w + 1) + (x + 1);
      integral[idx] = integral[y * (w + 1) + (x + 1)] + rowSum;
      integralSq[idx] = integralSq[y * (w + 1) + (x + 1)] + rowSumSq;
    }
  }

  let globalSum = 0;
  for (let i = 0; i < gray.length; i++) globalSum += gray[i];
  const globalMean = globalSum / (w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - halfBlock);
      const y1 = Math.max(0, y - halfBlock);
      const x2 = Math.min(w - 1, x + halfBlock);
      const y2 = Math.min(h - 1, y + halfBlock);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      const sum = integral[(y2 + 1) * (w + 1) + (x2 + 1)]
        - integral[y1 * (w + 1) + (x2 + 1)]
        - integral[(y2 + 1) * (w + 1) + x1]
        + integral[y1 * (w + 1) + x1];

      const sumSq = integralSq[(y2 + 1) * (w + 1) + (x2 + 1)]
        - integralSq[y1 * (w + 1) + (x2 + 1)]
        - integralSq[(y2 + 1) * (w + 1) + x1]
        + integralSq[y1 * (w + 1) + x1];

      const localMean = sum / count;
      const localVar = Math.max(0, (sumSq / count) - (localMean * localMean));
      const localStd = Math.sqrt(localVar);

      const val = gray[y * w + x];

      // Sobel gradient magnitude for sharp wall edge verification
      let gx = 0, gy = 0;
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1) {
        gx = (gray[(y-1)*w + (x+1)] + 2*gray[y*w + (x+1)] + gray[(y+1)*w + (x+1)]) -
             (gray[(y-1)*w + (x-1)] + 2*gray[y*w + (x-1)] + gray[(y+1)*w + (x-1)]);
        gy = (gray[(y+1)*w + (x-1)] + 2*gray[(y+1)*w + x] + gray[(y+1)*w + (x+1)]) -
             (gray[(y-1)*w + (x-1)] + 2*gray[(y-1)*w + x] + gray[(y-1)*w + (x+1)]);
      }
      const grad = Math.sqrt(gx * gx + gy * gy);

      // A pixel is a wall if it is significantly darker than local mean AND has high local variance or gradient
      const isDark = val < (localMean - 8) && val < 180;
      const isEdgeOrWall = (grad > 35 || localStd > 15) && val < (globalMean * 0.90);

      binary[y * w + x] = (isDark || isEdgeOrWall) ? 255 : 0;
    }
  }

  // Clear outer frame border noise if edge connected to perimeter
  for (let x = 0; x < w; x++) { binary[x] = 0; binary[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { binary[y * w] = 0; binary[y * w + (w - 1)] = 0; }

  return binary;
}

/**
 * Room Recognition & Region Labeling Strategy
 */
function detectRealtimeRooms(cleanedWallMap: Uint8Array, w: number, h: number): Room[] {
  const minRoomArea = Math.round(w * h * 0.003); // 0.3% minimum room size
  const maxRoomArea = Math.round(w * h * 0.65);  // Ignore background
  const visited = new Uint8Array(w * h);
  const rooms: Room[] = [];

  const REALTIME_ROOM_NAMES = [
    'Living Area', 'Bedroom', 'Kitchen', 'Bathroom', 'Dining Area',
    'Walk-In Closet', 'Laundry', 'Hallway', 'Terrace',
    'Family Room', 'Master Bedroom', 'Pantry', 'Study', 'Storage'
  ];

  let roomCounter = 0;

  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = y * w + x;
      if (cleanedWallMap[idx] === 0 && visited[idx] === 0) {
        const queue: number[] = [x, y];
        const pixels: [number, number][] = [];
        visited[idx] = 1;

        while (queue.length > 0) {
          const cy = queue.pop()!;
          const cx = queue.pop()!;
          pixels.push([cx, cy]);

          const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
          for (const [nx, ny] of neighbors) {
            if (nx >= 1 && nx < w - 1 && ny >= 1 && ny < h - 1) {
              const nIdx = ny * w + nx;
              if (cleanedWallMap[nIdx] === 0 && visited[nIdx] === 0) {
                visited[nIdx] = 1;
                queue.push(nx, ny);
              }
            }
          }
        }

        if (pixels.length >= minRoomArea && pixels.length <= maxRoomArea) {
          let minX = w, minY = h, maxX = 0, maxY = 0;
          let sumX = 0, sumY = 0;

          for (const [px, py] of pixels) {
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
            sumX += px;
            sumY += py;
          }

          const boxW = maxX - minX + 1;
          const boxH = maxY - minY + 1;
          const fillRatio = pixels.length / (boxW * boxH);

          if (fillRatio > 0.20) {
            const paletteEntry = ROOM_PALETTE[roomCounter % ROOM_PALETTE.length];
            rooms.push({
              id: `room-${roomCounter}`,
              name: '',
              centerX: sumX / pixels.length,
              centerY: sumY / pixels.length,
              bounds: { minX, minY, maxX, maxY },
              area: pixels.length,
              color: paletteEntry.color,
              borderColor: paletteEntry.borderColor,
            });
            roomCounter++;
          }
        }
      }
    }
  }

  rooms.sort((a, b) => b.area - a.area);

  rooms.forEach((room, i) => {
    room.id = `room-${i}`;
    const paletteEntry = ROOM_PALETTE[i % ROOM_PALETTE.length];
    room.color = paletteEntry.color;
    room.borderColor = paletteEntry.borderColor;

    const relArea = room.area / (w * h);
    if (relArea > 0.15) {
      room.name = i === 0 ? 'Living Area' : 'Great Room';
    } else if (relArea > 0.07) {
      room.name = i <= 2 ? 'Bedroom' : 'Kitchen';
    } else if (relArea > 0.035) {
      room.name = i % 2 === 0 ? 'Dining Area' : 'Bathroom';
    } else if (relArea > 0.015) {
      room.name = i % 2 === 0 ? 'Laundry' : 'Hallway';
    } else {
      room.name = REALTIME_ROOM_NAMES[i % REALTIME_ROOM_NAMES.length];
    }
  });

  return rooms;
}

/**
 * Fallback room generator if structural image analysis produces 0 room polygons
 */
function generateFallbackRooms(w: number, h: number): Room[] {
  const margin = Math.round(w * 0.08);
  const midX = Math.round(w / 2);
  const midY = Math.round(h / 2);
  const roomDefs = [
    { name: 'Living Area', minX: margin, minY: margin, maxX: midX - 2, maxY: midY - 2 },
    { name: 'Kitchen & Dining', minX: midX + 2, minY: margin, maxX: w - margin, maxY: midY - 2 },
    { name: 'Bedroom', minX: margin, minY: midY + 2, maxX: midX - 2, maxY: h - margin },
    { name: 'Bathroom', minX: midX + 2, minY: midY + 2, maxX: w - margin, maxY: h - margin },
  ];

  return roomDefs.map((def, i) => {
    const palette = ROOM_PALETTE[i % ROOM_PALETTE.length];
    const boxW = def.maxX - def.minX + 1;
    const boxH = def.maxY - def.minY + 1;
    return {
      id: `room-${i}`,
      name: def.name,
      centerX: (def.minX + def.maxX) / 2,
      centerY: (def.minY + def.maxY) / 2,
      bounds: { minX: def.minX, minY: def.minY, maxX: def.maxX, maxY: def.maxY },
      area: boxW * boxH,
      color: palette.color,
      borderColor: palette.borderColor,
    };
  });
}

/**
 * Main analysis function - processes uploaded blueprint image in real-time
 */
export async function analyzeBlueprint(imageFile: File): Promise<BlueprintData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const GRID_SIZE = 120;
        const aspect = img.width / img.height;
        const gridW = aspect >= 1 ? GRID_SIZE : Math.round(GRID_SIZE * aspect);
        const gridH = aspect >= 1 ? Math.round(GRID_SIZE / aspect) : GRID_SIZE;
        const gridScale = img.width / gridW;

        // Step 1: Extract pixel data at target grid resolution
        const imageData = getImageData(img, gridW, gridH);
        const gray = toGrayscale(imageData);

        // Step 2: Smart Wall Detection
        const binary = smartWallDetection(gray, gridW, gridH);

        // Step 3: Morphological operations for room isolation
        const closed = morphClose(binary, gridW, gridH, 5);
        const cleaned = morphOpen(closed, gridW, gridH, 3);

        // Step 4: Detect real-time rooms
        let rooms = detectRealtimeRooms(cleaned, gridW, gridH);

        if (rooms.length === 0) {
          const fallbackCleaned = morphOpen(morphClose(binary, gridW, gridH, 3), gridW, gridH, 2);
          rooms = detectRealtimeRooms(fallbackCleaned, gridW, gridH);
        }

        if (rooms.length === 0) {
          rooms = generateFallbackRooms(gridW, gridH);
        }

        // Step 5: Build navigation grid from binary
        const navBinary = morphOpen(binary, gridW, gridH, 2);
        const grid: number[][] = [];
        for (let y = 0; y < gridH; y++) {
          const row: number[] = [];
          for (let x = 0; x < gridW; x++) {
            row.push(navBinary[y * gridW + x] === 255 ? 1 : 0);
          }
          grid.push(row);
        }

        // Ensure centers of detected rooms are walkable (0)
        rooms.forEach(r => {
          const cx = Math.round(r.centerX);
          const cy = Math.round(r.centerY);
          if (cy >= 0 && cy < gridH && cx >= 0 && cx < gridW) {
            grid[cy][cx] = 0;
          }
        });

        // Step 6: Extract wall segments for 3D rendering
        const walls = extractWalls(binary, gridW, gridH, gridScale);

        resolve({
          walls,
          rooms,
          grid,
          width: gridW,
          height: gridH,
          gridScale,
        });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Failed to load blueprint image'));
    img.src = URL.createObjectURL(imageFile);
  });
}

/**
 * Generate a demo blueprint data (simple house layout)
 */
export function generateDemoBlueprint(): BlueprintData {
  const W = 60;
  const H = 50;
  const grid: number[][] = Array.from({ length: H }, () => Array(W).fill(0));

  const drawWall = (x1: number, y1: number, x2: number, y2: number) => {
    if (x1 === x2) {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        if (y >= 0 && y < H && x1 >= 0 && x1 < W) grid[y][x1] = 1;
      }
    } else {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
        if (y1 >= 0 && y1 < H && x >= 0 && x < W) grid[y1][x] = 1;
      }
    }
  };

  // Outer walls
  drawWall(5, 5, 55, 5);
  drawWall(5, 45, 55, 45);
  drawWall(5, 5, 5, 45);
  drawWall(55, 5, 55, 45);

  // Horizontal divider
  drawWall(5, 25, 30, 25);
  drawWall(35, 25, 55, 25);

  // Vertical divider top
  drawWall(30, 5, 30, 20);
  drawWall(30, 23, 30, 25);

  // Vertical divider bottom
  drawWall(30, 25, 30, 40);
  drawWall(30, 43, 30, 45);

  // Small room partition (bathroom)
  drawWall(42, 25, 42, 37);
  drawWall(42, 40, 42, 45);
  drawWall(42, 37, 50, 37);
  drawWall(53, 37, 55, 37);

  const walls: Wall[] = [];
  const gridScale = 10;

  const rooms: Room[] = [
    {
      id: 'room-0', name: 'Living Room',
      centerX: 17, centerY: 15,
      bounds: { minX: 6, minY: 6, maxX: 29, maxY: 24 },
      area: 400, color: ROOM_PALETTE[0].color, borderColor: ROOM_PALETTE[0].borderColor
    },
    {
      id: 'room-1', name: 'Kitchen',
      centerX: 42, centerY: 15,
      bounds: { minX: 31, minY: 6, maxX: 54, maxY: 24 },
      area: 400, color: ROOM_PALETTE[1].color, borderColor: ROOM_PALETTE[1].borderColor
    },
    {
      id: 'room-2', name: 'Bedroom',
      centerX: 17, centerY: 35,
      bounds: { minX: 6, minY: 26, maxX: 29, maxY: 44 },
      area: 400, color: ROOM_PALETTE[2].color, borderColor: ROOM_PALETTE[2].borderColor
    },
    {
      id: 'room-3', name: 'Bathroom',
      centerX: 48, centerY: 41,
      bounds: { minX: 43, minY: 38, maxX: 54, maxY: 44 },
      area: 100, color: ROOM_PALETTE[3].color, borderColor: ROOM_PALETTE[3].borderColor
    },
    {
      id: 'room-4', name: 'Dining Room',
      centerX: 36, centerY: 35,
      bounds: { minX: 31, minY: 26, maxX: 41, maxY: 44 },
      area: 180, color: ROOM_PALETTE[4].color, borderColor: ROOM_PALETTE[4].borderColor
    },
  ];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] === 1) {
        if (x === 0 || grid[y][x - 1] === 0) {
          let endX = x;
          while (endX < W && grid[y][endX] === 1) endX++;
          if (endX - x > 1) {
            walls.push({
              x1: x * gridScale, y1: y * gridScale,
              x2: endX * gridScale, y2: y * gridScale
            });
          }
        }
      }
    }
  }

  return { walls, rooms, grid, width: W, height: H, gridScale };
}
