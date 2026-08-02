/**
 * Smart shape recognizer — turns roughly-drawn strokes into clean vector
 * shapes (circle / rectangle / line / arrow). Pure rules, no ML.
 *
 * Pipeline per stroke: decimate (drop near-duplicate points) -> bbox features
 * -> Douglas-Peucker simplification (dominant corners) + local-angle corner
 * counting -> closure / roundness / aspect / V-triangle tests -> best match
 * with a confidence score. Callers should only auto-transform when
 * confidence >= RECOGNIZE_THRESHOLD.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface RecognizedShape {
  kind: "circle" | "rect" | "line" | "arrow";
  confidence: number;
  /** Fitted axis-aligned bounding box in the stroke's coordinate space. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Direction for recognized arrows, in radians. */
  angle?: number;
}

export const RECOGNIZE_THRESHOLD = 0.65;

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Drop consecutive points closer than `minStep` so noisy sketches don't skew features. */
function decimate(points: Pt[], minStep = 2): Pt[] {
  const out: Pt[] = [];
  let last: Pt | null = null;
  for (const p of points) {
    if (!last || dist(p, last) >= minStep) {
      out.push(p);
      last = p;
    }
  }
  return out;
}

/** Ramer-Douglas-Peucker polyline simplification -> dominant corner vertices. */
function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length <= 2) return [...points];
  let maxDist = 0;
  let idx = 0;
  const a = points[0];
  const b = points[points.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const proj = { x: a.x + t * dx, y: a.y + t * dy };
    const d = dist(p, proj);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, idx + 1), epsilon);
    const right = simplify(points.slice(idx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [a, b];
}

function angleDeg(v1: Pt, v2: Pt): number {
  const d1 = Math.hypot(v1.x, v1.y) || 1;
  const d2 = Math.hypot(v2.x, v2.y) || 1;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (d1 * d2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Smallest interior angle of the triangle formed by the polyline's last 3 points. */
function endTriangle(points: Pt[]): { angle: number; sides: [number, number, number] } | null {
  const k = points.length;
  if (k < 3) return null;
  const a = points[k - 3];
  const b = points[k - 2];
  const c = points[k - 1];
  const s1 = dist(a, b);
  const s2 = dist(b, c);
  const s3 = dist(a, c);
  if (s1 < 2 || s2 < 2 || s3 < 2) return null;
  const cosA = (s2 * s2 + s3 * s3 - s1 * s1) / (2 * s2 * s3);
  const cosB = (s1 * s1 + s3 * s3 - s2 * s2) / (2 * s1 * s3);
  const cosC = (s1 * s1 + s2 * s2 - s3 * s3) / (2 * s1 * s2);
  const angles = [cosA, cosB, cosC].map((c) => (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI);
  return { angle: Math.min(...angles), sides: [s1, s2, s3] };
}

/**
 * Count simplified vertices whose interior angle is near 90 degrees.
 * Hand-drawn rectangles collapse to 4-7 DP vertices with most corners in
 * [65, 115]; circles collapse to many vertices with ~150 degree angles, so
 * this cleanly separates the two.
 */
function rightAngleCount(pts: Pt[]): number {
  let anglesOk = 0;
  const n = pts.length;
  for (let i = 1; i < n - 1; i++) {
    const v1 = { x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y };
    const v2 = { x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y };
    const a = angleDeg(v1, v2);
    if (a >= 65 && a <= 115) anglesOk++;
  }
  return anglesOk;
}

export function recognizeStroke(points: Pt[]): RecognizedShape | null {
  const raw = decimate(points);
  if (raw.length < 8) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of raw) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const diag = Math.hypot(w, h) || 1;
  if (diag < 12) return null;

  const eps = Math.max(2.5, diag * 0.03);
  const simplified = simplify(raw, eps);
  const gap = dist(raw[0], raw[raw.length - 1]);
  const closed = gap <= Math.max(diag * 0.18, 14);
  const aspect = Math.max(w, h) / (Math.min(w, h) || 1);

  const bboxOf = () => ({ x: minX, y: minY, w, h });
  const rightAngles = rightAngleCount(simplified);
  const aspectOk = Math.min(w, h) / Math.max(w, h) > 0.3;

  // radius variance around the centroid (~0 = perfect circle)
  let cx = 0, cy = 0;
  for (const p of raw) {
    cx += p.x;
    cy += p.y;
  }
  cx /= raw.length;
  cy /= raw.length;
  let sumR = 0;
  for (const p of raw) sumR += Math.hypot(p.x - cx, p.y - cy);
  const meanR = sumR / raw.length;
  let sumDev = 0;
  if (closed && meanR >= 5) {
    for (const p of raw) sumDev += Math.abs(Math.hypot(p.x - cx, p.y - cy) - meanR);
  }
  const roundness = meanR >= 5 ? sumDev / raw.length / meanR : Infinity;

  // ---- Circle (strong): closed, near-perfect roundness, no right angles ----
  if (closed && aspect <= 1.5 && roundness < 0.18 && rightAngles <= 1) {
    const confidence = Math.min(0.96, 0.6 + (0.18 - roundness) * 1.5 + (simplified.length >= 8 ? 0.06 : 0));
    if (confidence >= RECOGNIZE_THRESHOLD) {
      return { kind: "circle", confidence, x: cx - meanR, y: cy - meanR, w: meanR * 2, h: meanR * 2 };
    }
  }

  // ---- Rectangle: closed loop collapsing to ~4-7 DP vertices with 90-degree corners ----
  if (closed && simplified.length >= 4 && simplified.length <= 7) {
    const n = simplified.length;
    if (rightAngles >= 2 && rightAngles >= n - 4 && aspectOk) {
      const confidence = Math.min(0.95, 0.55 + rightAngles * 0.08 + (aspectOk ? 0.1 : 0));
      if (confidence >= RECOGNIZE_THRESHOLD) {
        return { kind: "rect", confidence, ...bboxOf() };
      }
    }
  }

  // ---- Circle (weak): closed, still quite round, many vertices (no 90 deg corners) ----
  if (closed && aspect <= 1.5 && simplified.length >= 8 && rightAngles <= 1 && roundness < 0.22) {
    const confidence = Math.min(0.96, 0.6 + (0.22 - roundness) * 1.5 + 0.06);
    if (confidence >= RECOGNIZE_THRESHOLD) {
      return { kind: "circle", confidence, x: cx - meanR, y: cy - meanR, w: meanR * 2, h: meanR * 2 };
    }
  }

  // ---- Line: open stroke, straight-ish, clearly elongated ----
  if (!closed && simplified.length <= 3 && aspect >= 1.5) {
    const confidence = Math.min(0.92, 0.55 + aspect / 14 + (simplified.length === 2 ? 0.12 : 0));
    if (confidence >= RECOGNIZE_THRESHOLD) {
      return { kind: "line", confidence, ...bboxOf() };
    }
  }

  // ---- Arrow: open stroke whose end forms a sharp V-triangle on a straight shaft ----
  if (!closed && simplified.length >= 4) {
    let best = 0;
    let bestAngle = 0;
    for (const pts of [simplified, [...simplified].reverse()]) {
      const tri = endTriangle(pts);
      if (!tri) continue;
      const { angle, sides } = tri;
      if (angle < 15 || angle > 85) continue;
      // other two angles must be obtuse-ish (a real V, not a flat sliver)
      const k = pts.length;
      if (k < 3) continue;
      const b = pts[k - 2];
      const a1 = angleDeg({ x: pts[k - 3].x - b.x, y: pts[k - 3].y - b.y }, { x: pts[k - 1].x - b.x, y: pts[k - 1].y - b.y });
      if (a1 < 35) continue;
      // straight shaft: the prefix (everything before the V) simplifies to <= 1 bend
      const prefix = simplify(pts.slice(0, k - 2), eps);
      if (prefix.length > 3) continue;
      // head must not dominate the stroke
      let shaftLen = 0;
      for (let i = 1; i < k - 2; i++) shaftLen += dist(pts[i - 1], pts[i]);
      const headShare = (sides[0] + sides[1]) / (shaftLen + sides[0] + sides[1]);
      if (headShare > 0.45) continue;
      const confidence = Math.min(0.94, 0.62 + (1 - Math.abs(angle - 45) / 45) * 0.18 + (headShare < 0.3 ? 0.05 : 0));
      if (confidence > best) {
        best = confidence;
        bestAngle = Math.atan2(b.y - pts[0].y, b.x - pts[0].x);
      }
    }
    if (best >= RECOGNIZE_THRESHOLD) {
      return { kind: "arrow", confidence: best, angle: bestAngle, ...bboxOf() };
    }
  }

  return null;
}
