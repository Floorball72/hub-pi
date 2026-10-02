// Kleine Geo Hilfen: Distanz, Punkt in Polygon.

export function distanzKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Polygon als Liste von [lat, lon] */
export function imPolygon(lat: number, lon: number, poly: [number, number][]): boolean {
  let drin = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) drin = !drin;
  }
  return drin;
}

export function rahmen(lat: number, lon: number, radiusKm: number) {
  const dLat = radiusKm / 111.2;
  const dLon = radiusKm / (111.2 * Math.cos((lat * Math.PI) / 180));
  return { sued: lat - dLat, nord: lat + dLat, west: lon - dLon, ost: lon + dLon };
}

export function richtungText(grad: number): string {
  const r = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return r[Math.round((((grad % 360) + 360) % 360) / 45) % 8];
}
