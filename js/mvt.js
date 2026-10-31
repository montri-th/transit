/**
 * Minimal Mapbox Vector Tile (MVT v2) reader for polygon layers.
 *
 * Purpose-built for the OpenMapTiles `building` layer served by OpenFreeMap:
 * it reads layer name/extent/keys/values, feature id/type/tags and decodes the
 * geometry command stream into rings in tile units (0…extent). Nothing else
 * (no sprite, no fonts, no styling) — the map itself is still rendered by
 * MapLibre from the same tiles; this reader only exists so the focused part
 * of the city can be re-shaped client-side (rounded, enclosing massing).
 *
 * Spec: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 * Own implementation (no third-party code); varints up to 64 bits are read
 * into JavaScript numbers, which is exact for OSM ids (< 2^53).
 */

const TWO_32 = 2 ** 32;

class Reader {
  constructor(bytes) {
    this.buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.pos = 0;
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
  }
  get eof() { return this.pos >= this.buf.length; }
  /** Unsigned varint (up to 64 bits) as a JavaScript number. */
  varint() {
    let low = 0, high = 0, shift = 0, b;
    for (;;) {
      b = this.buf[this.pos++];
      if (b === undefined) throw new RangeError('Truncated varint');
      if (shift < 28) {
        low |= (b & 0x7f) << shift;
        if (b < 0x80) return low >>> 0;
      } else if (shift === 28) {
        low |= (b & 0x0f) << 28;
        high |= (b & 0x70) >>> 4;
        if (b < 0x80) return (high >>> 0) * TWO_32 + (low >>> 0);
      } else {
        high |= (b & 0x7f) << (shift - 32);
        if (b < 0x80) return (high >>> 0) * TWO_32 + (low >>> 0);
      }
      shift += 7;
      if (shift > 63) throw new RangeError('Varint too long');
    }
  }
  svarint() {
    const n = this.varint();
    // zigzag: even → positive, odd → negative; exact for |n| < 2^53
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }
  bytes() { const n = this.varint(), out = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return out; }
  string() { return new TextDecoder('utf-8').decode(this.bytes()); }
  fixed32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  float() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  double() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  fixed64() { const lo = this.view.getUint32(this.pos, true), hi = this.view.getUint32(this.pos + 4, true); this.pos += 8; return hi * TWO_32 + lo; }
  sfixed64() { const lo = this.view.getUint32(this.pos, true), hi = this.view.getInt32(this.pos + 4, true); this.pos += 8; return hi * TWO_32 + lo; }
  skip(wireType) {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.pos += 8;
    else if (wireType === 2) this.pos += this.varint();
    else if (wireType === 5) this.pos += 4;
    else throw new RangeError(`Unsupported wire type ${wireType}`);
  }
  /** Iterate fields of an embedded message that ends at `end`. */
  fields(end, onField) {
    while (this.pos < end) {
      const tag = this.varint();
      onField(tag >>> 3, tag & 7);
    }
  }
}

function readValue(r, end) {
  let value = null;
  r.fields(end, (field, wire) => {
    if (field === 1) value = r.string();
    else if (field === 2) value = r.float();
    else if (field === 3) value = r.double();
    else if (field === 4) value = r.varint();          // int64 (non-negative in practice)
    else if (field === 5) value = r.varint();          // uint64
    else if (field === 6) value = r.svarint();         // sint64
    else if (field === 7) value = r.varint() !== 0;    // bool
    else r.skip(wire);
  });
  return value;
}

function decodeGeometry(bytes, type) {
  const r = new Reader(bytes);
  const rings = [];
  let ring = null, x = 0, y = 0;
  while (!r.eof) {
    const cmdLen = r.varint(), cmd = cmdLen & 7, count = cmdLen >>> 3;
    if (cmd === 1) { // MoveTo
      for (let i = 0; i < count; i++) { x += r.svarint(); y += r.svarint(); ring = [[x, y]]; rings.push(ring); }
    } else if (cmd === 2) { // LineTo
      for (let i = 0; i < count; i++) { x += r.svarint(); y += r.svarint(); ring.push([x, y]); }
    } else if (cmd === 7) { // ClosePath
      if (ring && type === 3) ring.push([ring[0][0], ring[0][1]]);
    } else throw new RangeError(`Unknown geometry command ${cmd}`);
  }
  return rings;
}

function readFeature(r, end, keys, values) {
  const feature = {id: undefined, type: 0, properties: {}, geometryBytes: null};
  r.fields(end, (field, wire) => {
    if (field === 1) feature.id = r.varint();
    else if (field === 2) {
      const tagsEnd = r.varint() + r.pos;
      while (r.pos < tagsEnd) { const k = r.varint(), v = r.varint(); feature.properties[keys[k]] = values[v]; }
    } else if (field === 3) feature.type = r.varint();
    else if (field === 4) feature.geometryBytes = r.bytes();
    else r.skip(wire);
  });
  return feature;
}

function readLayer(r, end) {
  const layer = {name: '', extent: 4096, version: 1, keys: [], values: [], features: []};
  const featureSpans = [];
  r.fields(end, (field, wire) => {
    if (field === 15) layer.version = r.varint();
    else if (field === 1) layer.name = r.string();
    else if (field === 2) { const n = r.varint(); featureSpans.push([r.pos, r.pos + n]); r.pos += n; }
    else if (field === 3) layer.keys.push(r.string());
    else if (field === 4) { const n = r.varint(); layer.values.push(readValue(r, r.pos + n)); }
    else if (field === 5) layer.extent = r.varint();
    else r.skip(wire);
  });
  for (const [start, stop] of featureSpans) {
    r.pos = start;
    layer.features.push(readFeature(r, stop, layer.keys, layer.values));
  }
  r.pos = end; // features were parsed out of order; continue after the whole layer
  return layer;
}

/**
 * Parse a tile. Returns {layers: {name: {name, extent, features: [{id, type, properties, rings()}]}}}
 * where `rings()` decodes the geometry lazily into [[x, y], …] arrays in tile units.
 * type: 1 point, 2 line, 3 polygon (rings closed; outer/inner by winding, see geometry.js).
 */
export function parseVectorTile(bytes) {
  const r = new Reader(bytes);
  const layers = {};
  r.fields(r.buf.length, (field, wire) => {
    if (field === 3) { const n = r.varint(); const layer = readLayer(r, r.pos + n); layers[layer.name] = layer; }
    else r.skip(wire);
  });
  for (const layer of Object.values(layers)) {
    for (const f of layer.features) {
      const bytes = f.geometryBytes;
      let cached = null;
      f.rings = () => (cached ||= bytes ? decodeGeometry(bytes, f.type) : []);
      delete f.geometryBytes;
    }
  }
  return {layers};
}

/** Web-Mercator tile coordinate helpers (z/x/y of the tile containing lon/lat). */
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return {x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)), z};
}

/** Convert tile-unit coordinates to [lon, lat] for tile z/x/y with the given extent. */
export function tileToLonLat(px, py, {x, y, z}, extent = 4096) {
  const n = 2 ** z;
  const lon = ((x + px / extent) / n) * 360 - 180;
  const yy = (y + py / extent) / n;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))) * 180) / Math.PI;
  return [lon, lat];
}

/** Inverse of tileToLonLat: [lon, lat] → [px, py] in tile units of tile z/x/y (may fall outside 0…extent). */
export function lonLatToTileUnits(lon, lat, {x, y, z}, extent = 4096) {
  const n = 2 ** z;
  const px = (((lon + 180) / 360) * n - x) * extent;
  const rad = (lat * Math.PI) / 180;
  const py = (((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n - y) * extent;
  return [px, py];
}

/** All tiles at zoom z touched by a lon/lat bounding box [west, south, east, north]. */
export function tilesForBBox([west, south, east, north], z) {
  const a = lonLatToTile(west, north, z), b = lonLatToTile(east, south, z);
  const tiles = [];
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) tiles.push({x, y, z});
  return tiles;
}

/** Approximate metres per tile unit at this tile's latitude (for display radii). */
export function metresPerTileUnit({y, z}, extent = 4096) {
  const n = 2 ** z;
  const latMid = tileToLonLat(0, extent / 2, {x: 0, y, z}, extent)[1];
  const tileWidthM = (40075016.686 * Math.cos((latMid * Math.PI) / 180)) / n;
  return tileWidthM / extent;
}
