import { nanoid } from "nanoid";
import { Point } from "./elements/ExcalidrawElement";

// Simple Math.random-based replacement for roughjs's Random — avoids pulling
// roughjs into the bundle. Deterministic quality is not required for
// id-style randomness here (seed/version fields).
export const randomInteger = (): number => Math.floor(Math.random() * 2 ** 31);

export const randomId = (): string => nanoid();

export const safeNumber = (number: number): number => Number(number.toFixed(2));

export function dimensionsFromPoints(points: number[][]): number[] {
  const xCoords = points.map(([x]) => x);
  const yCoords = points.map(([, y]) => y);

  const minX = Math.min(...xCoords);
  const minY = Math.min(...yCoords);
  const maxX = Math.max(...xCoords);
  const maxY = Math.max(...yCoords);

  return [maxX - minX, maxY - minY];
}

// winding order is clockwise values is positive, counter clockwise if negative.
export function getWindingOrder(
  points: Point[],
): "clockwise" | "counterclockwise" {
  const total = points.reduce((acc, [x1, y1], idx, arr) => {
    const p2 = arr[idx + 1];
    const x2 = p2 ? p2[0] : 0;
    const y2 = p2 ? p2[1] : 0;

    const e = (x2 - x1) * (y2 + y1);

    return e + acc;
  }, 0);

  return total > 0 ? "clockwise" : "counterclockwise";
}
