// Headless smoke test for the Minecraft clone's non-rendering logic.
// Mocks the parts of THREE used by world.js / player.js so we can run
// terrain generation, collision, and block editing in Node.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  crossVectors(a, b) {
    this.x = a.y * b.z - a.z * b.y;
    this.y = a.z * b.x - a.x * b.z;
    this.z = a.x * b.y - a.y * b.x;
    return this;
  }
  normalize() {
    const l = Math.hypot(this.x, this.y, this.z) || 1;
    this.x /= l; this.y /= l; this.z /= l; return this;
  }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  applyMatrix4() { return this; }
  applyMatrix3() { return this; }
}

class Color { constructor(c) { this.r = 1; this.g = 1; this.b = 1; } }
class Matrix3 { getNormalMatrix() { return this; } }
class Matrix4 { lookAt() { return this; } }
class BufferGeometry {
  setAttribute() { return this; }
  setIndex() { return this; }
  dispose() {}
}
class Float32BufferAttribute { constructor() {} }
class MeshLambertMaterial { constructor() {} dispose() {} }
class Mesh { constructor() { this.userData = {}; } }
class Scene { add() {} remove() {} }
class FrontSide {}
class DoubleSide {}
class DataTexture {
  constructor() {
    this.needsUpdate = false;
    this.magFilter = 0;
    this.minFilter = 0;
    this.generateMipmaps = false;
    this.flipY = true;
    this.colorSpace = '';
  }
}
class CanvasTexture extends DataTexture {}
const NearestFilter = 1003;
const SRGBColorSpace = 'srgb';

const THREE = {
  Vector3, Color, Matrix3, Matrix4, BufferGeometry,
  Float32BufferAttribute, MeshLambertMaterial, Mesh, Scene,
  FrontSide, DoubleSide, DataTexture, CanvasTexture,
  NearestFilter, SRGBColorSpace,
};

// Minimal BufferGeometryUtils mock (mergeGeometries not needed for logic test)
const BufferGeometryUtils = { mergeGeometries: (geos) => geos[0] || null };
globalThis.__BGU__ = BufferGeometryUtils;

// Patch module resolution by injecting globals via a small loader.
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { register } from 'node:module';

// Create temporary shim modules so the real source files can import 'three'.
mkdirSync('test/shims', { recursive: true });
writeFileSync('test/shims/three.js', `const T = globalThis.__THREE__;
export const Vector3 = T.Vector3; export const Color = T.Color; export const Matrix3 = T.Matrix3; export const Matrix4 = T.Matrix4;
export const BufferGeometry = T.BufferGeometry; export const Float32BufferAttribute = T.Float32BufferAttribute;
export const MeshLambertMaterial = T.MeshLambertMaterial; export const Mesh = T.Mesh; export const Scene = T.Scene;
export const FrontSide = T.FrontSide; export const DoubleSide = T.DoubleSide;
export const DataTexture = T.DataTexture; export const CanvasTexture = T.CanvasTexture;
export const NearestFilter = T.NearestFilter; export const SRGBColorSpace = T.SRGBColorSpace;
export default T;`);
writeFileSync('test/shims/three-addons-utils.js', `const BGU = globalThis.__BGU__; export const mergeGeometries = BGU.mergeGeometries;`);

globalThis.__THREE__ = THREE;
globalThis.__BGU__ = BufferGeometryUtils;

// Use a custom loader to redirect 'three' and the addons import.
const loaderCode = `
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: ${JSON.stringify(pathToFileURL(process.cwd() + '/test/shims/three.js').href)}, shortCircuit: true };
  if (specifier === 'three/addons/utils/BufferGeometryUtils.js') return { url: ${JSON.stringify(pathToFileURL(process.cwd() + '/test/shims/three-addons-utils.js').href)}, shortCircuit: true };
  return next(specifier, context);
}
`;
writeFileSync('test/loader.mjs', loaderCode);

await register(pathToFileURL('./test/loader.mjs').href, {
  parentURL: pathToFileURL(import.meta.url).href,
});

const { World } = await import(pathToFileURL('./src/world.js').href);
const { getBlockType } = await import(pathToFileURL('./src/blocks.js').href);

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; }
  else console.log('ok:', msg);
}

const scene = new Scene();
const world = new World(scene);

// Generate a region around origin
world.generateAround(0, 0, 2);

assert(world.getLoadedChunks() > 0, 'chunks were created');

// Surface height should be a positive number
const surf = world.getSurfaceHeight(0, 0);
assert(surf > 0 && surf < 64, `surface height at origin = ${surf}`);

// Debug column at origin
const col = [];
for (let y = 0; y < 16; y++) col.push(world.getBlock(0, y, 0));
console.log('DEBUG column (0,0) y0..15:', col.join(','));

// Block below surface should be solid; the block at the surface should be
// non-solid (air, or liquid like water that pools above terrain).
const below = world.getBlock(0, surf - 1, 0);
const above = world.getBlock(0, surf, 0);
const aboveType = getBlockType(above);
assert(below !== 0, 'block below surface is solid');
assert(!aboveType.solid, 'block at surface is non-solid (air or liquid)');

// setBlock / getBlock round trip
const ok = world.setBlock(5, 30, 5, 'STONE');
assert(ok === true, 'setBlock returned true for new block');
assert(world.getBlock(5, 30, 5) === 3, 'getBlock returns STONE id (3)');
const ok2 = world.setBlock(5, 30, 5, 'STONE');
assert(ok2 === false, 'setBlock returns false when unchanged');

// Chunk boundary neighbor reads work (no throw)
const edge = world.getBlock(15, 20, 0);
assert(typeof edge === 'number', 'reading chunk-edge block does not throw');

// rebuildMesh should not throw with mocked THREE
let threw = false;
try {
  world.updateChunks(0, 0);
} catch (e) {
  threw = true;
  console.error('rebuild threw:', e.message);
}
assert(!threw, 'updateChunks/rebuildMesh runs without throwing');

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
