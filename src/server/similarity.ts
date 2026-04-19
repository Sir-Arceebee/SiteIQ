// Pure-TS similarity / clustering for the list analyzer.
// Features: [gas_m, power_m, school_m]. Missing values imputed with column mean.

export type RawPoint = {
  id: string;
  lat: number;
  lon: number;
  label?: string | null;
  gas_m: number | null;
  power_m: number | null;
  school_m: number | null;
};

export type ClusteredPoint = RawPoint & {
  cluster: number;
  pca: [number, number];
  similarity_to_centroid: number;
};

export type ClusterProfile = {
  cluster: number;
  size: number;
  mean_gas_km: number;
  mean_power_km: number;
  mean_school_km: number;
  archetype: string;
};

const FEATURE_COUNT = 3;

function impute(points: RawPoint[]): number[][] {
  const cols: number[][] = [[], [], []];
  for (const p of points) {
    if (p.gas_m != null) cols[0].push(p.gas_m);
    if (p.power_m != null) cols[1].push(p.power_m);
    if (p.school_m != null) cols[2].push(p.school_m);
  }
  const means = cols.map((c) => (c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0));
  return points.map((p) => [
    p.gas_m ?? means[0],
    p.power_m ?? means[1],
    p.school_m ?? means[2],
  ]);
}

function standardize(matrix: number[][]): { z: number[][]; mean: number[]; std: number[] } {
  const n = matrix.length;
  const mean = new Array(FEATURE_COUNT).fill(0);
  for (const row of matrix) for (let j = 0; j < FEATURE_COUNT; j++) mean[j] += row[j];
  for (let j = 0; j < FEATURE_COUNT; j++) mean[j] /= n;
  const std = new Array(FEATURE_COUNT).fill(0);
  for (const row of matrix) for (let j = 0; j < FEATURE_COUNT; j++) std[j] += (row[j] - mean[j]) ** 2;
  for (let j = 0; j < FEATURE_COUNT; j++) std[j] = Math.sqrt(std[j] / Math.max(1, n - 1)) || 1;
  const z = matrix.map((row) => row.map((v, j) => (v - mean[j]) / std[j]));
  return { z, mean, std };
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Simple k-means (k clusters, max 50 iters, deterministic seed via points).
function kmeans(points: number[][], k: number): { labels: number[]; centroids: number[][] } {
  const n = points.length;
  k = Math.min(k, n);
  // Initialize centroids by spreading across sorted-by-magnitude points.
  const order = points
    .map((p, i) => ({ i, mag: Math.hypot(...p) }))
    .sort((a, b) => a.mag - b.mag);
  const centroids: number[][] = [];
  for (let c = 0; c < k; c++) {
    const idx = Math.floor((c + 0.5) * (n / k));
    centroids.push([...points[order[idx].i]]);
  }
  const labels = new Array(n).fill(0);
  for (let iter = 0; iter < 50; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        let d = 0;
        for (let j = 0; j < FEATURE_COUNT; j++) d += (points[i][j] - centroids[c][j]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (labels[i] !== best) { labels[i] = best; moved = true; }
    }
    if (!moved) break;
    const sums = Array.from({ length: k }, () => new Array(FEATURE_COUNT).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      counts[labels[i]]++;
      for (let j = 0; j < FEATURE_COUNT; j++) sums[labels[i]][j] += points[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) for (let j = 0; j < FEATURE_COUNT; j++) centroids[c][j] = sums[c][j] / counts[c];
    }
  }
  return { labels, centroids };
}

// Power-iteration PCA → top-2 components (projection only; sufficient for viz).
function pca2(matrix: number[][]): [number, number][] {
  const n = matrix.length;
  if (n === 0) return [];
  // Covariance matrix (3x3, since FEATURE_COUNT=3)
  const cov: number[][] = [[0,0,0],[0,0,0],[0,0,0]];
  for (const row of matrix) {
    for (let i = 0; i < FEATURE_COUNT; i++)
      for (let j = 0; j < FEATURE_COUNT; j++)
        cov[i][j] += row[i] * row[j];
  }
  for (let i = 0; i < FEATURE_COUNT; i++)
    for (let j = 0; j < FEATURE_COUNT; j++)
      cov[i][j] /= Math.max(1, n - 1);

  const matVec = (m: number[][], v: number[]) =>
    m.map((row) => row.reduce((s, x, k) => s + x * v[k], 0));
  const norm = (v: number[]) => {
    const n_ = Math.hypot(...v) || 1;
    return v.map((x) => x / n_);
  };
  const sub = (m: number[][], scalar: number, v: number[]) =>
    m.map((row, i) => row.map((x, j) => x - scalar * v[i] * v[j]));

  // First PC
  let v1 = norm([1, 0.5, 0.25]);
  for (let i = 0; i < 100; i++) v1 = norm(matVec(cov, v1));
  const lam1 = matVec(cov, v1).reduce((s, x, i) => s + x * v1[i], 0);
  // Deflate, second PC
  const cov2 = sub(cov, lam1, v1);
  let v2 = norm([0.25, 1, 0.5]);
  for (let i = 0; i < 100; i++) v2 = norm(matVec(cov2, v2));

  return matrix.map((row) => [
    row.reduce((s, x, i) => s + x * v1[i], 0),
    row.reduce((s, x, i) => s + x * v2[i], 0),
  ] as [number, number]);
}

function archetypeName(profile: { gas: number; power: number; school: number }): string {
  // Heuristic naming based on relative distances (km).
  const closeGas = profile.gas < 5;
  const closePower = profile.power < 5;
  const farSchool = profile.school > 20;
  if (closeGas && closePower && farSchool) return "Premium remote";
  if (closeGas && closePower) return "Infrastructure-rich";
  if (closeGas) return "Pipeline corridor";
  if (closePower) return "Grid-adjacent";
  if (farSchool) return "Remote";
  return "Marginal";
}

export function analyze(points: RawPoint[], k = 4): {
  clustered: ClusteredPoint[];
  profiles: ClusterProfile[];
} {
  if (points.length === 0) return { clustered: [], profiles: [] };
  const imputed = impute(points);
  const { z } = standardize(imputed);
  const effectiveK = Math.max(1, Math.min(k, points.length));
  const { labels, centroids } = kmeans(z, effectiveK);
  const projected = pca2(z);

  const clustered: ClusteredPoint[] = points.map((p, i) => ({
    ...p,
    cluster: labels[i],
    pca: projected[i] ?? [0, 0],
    similarity_to_centroid: cosineSim(z[i], centroids[labels[i]]),
  }));

  const profiles: ClusterProfile[] = [];
  for (let c = 0; c < effectiveK; c++) {
    const members = clustered.filter((p) => p.cluster === c);
    if (members.length === 0) continue;
    const sums = members.reduce(
      (acc, p) => ({
        g: acc.g + (p.gas_m ?? 0),
        pw: acc.pw + (p.power_m ?? 0),
        s: acc.s + (p.school_m ?? 0),
      }),
      { g: 0, pw: 0, s: 0 },
    );
    const meanGasKm = sums.g / members.length / 1000;
    const meanPowerKm = sums.pw / members.length / 1000;
    const meanSchoolKm = sums.s / members.length / 1000;
    profiles.push({
      cluster: c,
      size: members.length,
      mean_gas_km: +meanGasKm.toFixed(2),
      mean_power_km: +meanPowerKm.toFixed(2),
      mean_school_km: +meanSchoolKm.toFixed(2),
      archetype: archetypeName({ gas: meanGasKm, power: meanPowerKm, school: meanSchoolKm }),
    });
  }
  return { clustered, profiles };
}
