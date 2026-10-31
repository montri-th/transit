/**
 * Google encoded polyline decoding for the compact optional layers
 * (data/bus.json, written by scripts/build-data.py at precision 5, (lat, lng)
 * pairs). Returns [lng, lat] pairs for GeoJSON.
 */
export function decodePolyline(encoded, precision = 5) {
  const factor = 10 ** precision, out = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0, result = 0, b;
      do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index <= encoded.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d; else lng += d;
    }
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

/** A point list stored as one polyline (consecutive deltas) — same encoding, read as separate points. */
export const decodePoints = (encoded, precision = 5) => (encoded ? decodePolyline(encoded, precision) : []);
