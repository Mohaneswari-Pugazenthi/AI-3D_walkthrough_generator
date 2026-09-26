/**
 * A* Pathfinding Algorithm
 * Grid-based navigation with obstacle (wall) avoidance
 */

export interface PathNode {
  x: number;
  y: number;
}

interface AStarNode {
  x: number;
  y: number;
  g: number; // cost from start
  h: number; // heuristic to end
  f: number; // g + h
  parent: AStarNode | null;
}

/**
 * Manhattan distance heuristic
 */
function heuristic(a: PathNode, b: PathNode): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * A* pathfinding on a 2D grid
 * grid[y][x] === 0 means walkable, 1 means wall
 * Returns array of coordinates from start to end, or empty if no path
 */
export function findPath(
  grid: number[][],
  start: PathNode,
  end: PathNode
): PathNode[] {
  const height = grid.length;
  const width = grid[0].length;

  // Clamp coordinates to grid
  const sx = Math.max(0, Math.min(width - 1, Math.round(start.x)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(start.y)));
  const ex = Math.max(0, Math.min(width - 1, Math.round(end.x)));
  const ey = Math.max(0, Math.min(height - 1, Math.round(end.y)));

  // If start or end is in a wall, find nearest walkable cell
  const findNearestWalkable = (px: number, py: number): PathNode => {
    if (grid[py]?.[px] === 0) return { x: px, y: py };
    for (let r = 1; r < Math.max(width, height); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === 0) {
            return { x: nx, y: ny };
          }
        }
      }
    }
    return { x: px, y: py };
  };

  const actualStart = findNearestWalkable(sx, sy);
  const actualEnd = findNearestWalkable(ex, ey);

  // Open and closed sets
  const openSet: AStarNode[] = [];
  const closedSet = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;

  const startNode: AStarNode = {
    x: actualStart.x, y: actualStart.y,
    g: 0,
    h: heuristic(actualStart, actualEnd),
    f: heuristic(actualStart, actualEnd),
    parent: null,
  };

  openSet.push(startNode);

  // 4-directional movement
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  while (openSet.length > 0) {
    // Find node with lowest f
    let lowestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[lowestIdx].f) lowestIdx = i;
    }
    const current = openSet.splice(lowestIdx, 1)[0];

    if (current.x === actualEnd.x && current.y === actualEnd.y) {
      // Reconstruct path
      const path: PathNode[] = [];
      let node: AStarNode | null = current;
      while (node) {
        path.unshift({ x: node.x, y: node.y });
        node = node.parent;
      }
      return path;
    }

    closedSet.add(key(current.x, current.y));

    for (const [dx, dy] of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;

      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (grid[ny][nx] === 1) continue;
      if (closedSet.has(key(nx, ny))) continue;

      // Diagonal movement cost
      const moveCost = dx !== 0 && dy !== 0 ? 1.414 : 1;
      
      // Prevent cutting corners for diagonal movement
      if (dx !== 0 && dy !== 0) {
        if (grid[current.y][nx] === 1 || grid[ny][current.x] === 1) continue;
      }

      const g = current.g + moveCost;
      const existing = openSet.find(n => n.x === nx && n.y === ny);

      if (existing) {
        if (g < existing.g) {
          existing.g = g;
          existing.f = g + existing.h;
          existing.parent = current;
        }
      } else {
        const h = heuristic({ x: nx, y: ny }, actualEnd);
        openSet.push({ x: nx, y: ny, g, h, f: g + h, parent: current });
      }
    }
  }

  return []; // No path found
}

/**
 * Smooth a path by removing unnecessary intermediate points
 */
export function smoothPath(path: PathNode[]): PathNode[] {
  if (path.length <= 2) return path;
  
  const smoothed: PathNode[] = [path[0]];
  
  for (let i = 1; i < path.length - 1; i++) {
    const prev = smoothed[smoothed.length - 1];
    const curr = path[i];
    const next = path[i + 1];
    
    // Keep point if direction changes
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    
    if (dx1 !== dx2 || dy1 !== dy2) {
      smoothed.push(curr);
    }
  }
  
  smoothed.push(path[path.length - 1]);
  return smoothed;
}
