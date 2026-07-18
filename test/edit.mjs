// Verifies block mining (set AIR), placement, unbreakable bedrock, and voxel raycast.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const three = `
class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;}
  normalize(){const l=Math.hypot(this.x,this.y,this.z)||1;this.x/=l;this.y/=l;this.z/=l;return this;}
  crossVectors(a,b){this.x=a.y*b.z-a.z*b.y;this.y=a.z*b.x-a.x*b.z;this.z=a.x*b.y-a.y*b.x;return this;}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
  applyMatrix3(){return this;}
  applyMatrix4(){return this;}
}
class Vector2 { constructor(x=0,y=0){this.x=x;this.y=y;} }
class Matrix3 { getNormalMatrix(){return this;} }
class Matrix4 { lookAt(){return this;} }
class Color { constructor(c){this.c=c;this.r=1;this.g=1;this.b=1;} }
class Scene { constructor(){this.children=[];} add(o){this.children.push(o);} remove(o){const i=this.children.indexOf(o);if(i>=0)this.children.splice(i,1);} }
class MeshLambertMaterial { constructor(o){Object.assign(this,o);} dispose(){} }
class Mesh { constructor(g,m){this.geometry=g;this.material=m;this.userData={};} }
class BufferGeometry { constructor(){this.attributes={};this.index=null;} setAttribute(n,a){this.attributes[n]=a;} setIndex(i){this.index=i;} dispose(){} }
class Float32BufferAttribute { constructor(a,n){this.array=a;this.itemSize=n;} }
const FrontSide=0, DoubleSide=2;
class DataTexture { constructor(){ this.needsUpdate=false; this.magFilter=0; this.minFilter=0; this.generateMipmaps=false; this.flipY=true; this.colorSpace=''; } }
class CanvasTexture extends DataTexture {}
const NearestFilter=1003, SRGBColorSpace='srgb';
const THREE = { Vector3, Vector2, Matrix3, Matrix4, Color, Scene, MeshLambertMaterial, Mesh, BufferGeometry, Float32BufferAttribute, FrontSide, DoubleSide, DataTexture, CanvasTexture, NearestFilter, SRGBColorSpace };
export default THREE;
export { Vector3, Vector2, Matrix3, Matrix4, Color, Scene, MeshLambertMaterial, Mesh, BufferGeometry, Float32BufferAttribute, FrontSide, DoubleSide, DataTexture, CanvasTexture, NearestFilter, SRGBColorSpace };
`;
const bgu = `export const mergeGeometries = (geos) => geos[0] || null;`;
writeFileSync('test/shims/three.js', three);
writeFileSync('test/shims/three-addons-utils.js', bgu);

const loader = `
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: ${JSON.stringify(pathToFileURL(process.cwd()+'/test/shims/three.js').href)}, shortCircuit: true };
  if (specifier === 'three/addons/utils/BufferGeometryUtils.js') return { url: ${JSON.stringify(pathToFileURL(process.cwd()+'/test/shims/three-addons-utils.js').href)}, shortCircuit: true };
  return next(specifier, context);
}
`;
writeFileSync('test/shims/loader.mjs', loader);
await register(pathToFileURL('./test/shims/loader.mjs').href, { parentURL: import.meta.url });

const THREE = (await import(pathToFileURL('./test/shims/three.js').href)).default;
const { World } = await import(pathToFileURL('./src/world.js').href);
const { BlockTypes } = await import(pathToFileURL('./src/blocks.js').href);

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('ok:', msg);
  else { console.error('FAIL:', msg); failures++; }
}

const scene = new THREE.Scene();
const world = new World(scene);
world.generateAround(0, 0, 1);

// --- break / place round trip ---
{
  const okPlace = world.setBlock(3, 25, 3, 'STONE');
  assert(okPlace === true, 'place STONE');
  assert(world.getBlock(3, 25, 3) === BlockTypes.STONE.id, 'STONE is present');

  const okBreak = world.setBlock(3, 25, 3, 'AIR');
  assert(okBreak === true, 'break to AIR');
  assert(world.getBlock(3, 25, 3) === 0, 'block is air after break');
}

// --- canBreak respects bedrock ---
{
  // Bedrock is generated at y=0
  assert(world.getBlock(0, 0, 0) === BlockTypes.BEDROCK.id, 'y=0 is bedrock');
  assert(world.canBreak(0, 0, 0) === false, 'bedrock is not breakable');
  // Grass/dirt somewhere near surface should be breakable
  const surf = world.getSurfaceHeight(2, 2);
  const below = surf - 1;
  if (below > 0) {
    assert(world.canBreak(2, below, 2) === true, `surface block at y=${below} is breakable`);
  }
}

// --- voxel raycast hits a placed block ---
{
  world.setBlock(5, 20, 5, 'DIRT');
  // Stand at (5.5, 20.5, 0) looking +Z toward the block at z=5
  const origin = new THREE.Vector3(5.5, 20.5, 0.5);
  const dir = new THREE.Vector3(0, 0, 1);
  const hit = world.raycast(origin, dir, 10);
  assert(!!hit, 'raycast returns a hit');
  if (hit) {
    assert(hit.x === 5 && hit.y === 20 && hit.z === 5, `raycast hits dirt at 5,20,5 (got ${hit.x},${hit.y},${hit.z})`);
    assert(hit.placeZ === 4, `place cell is adjacent on -Z (got placeZ=${hit.placeZ})`);
    assert(world.canBreak(hit.x, hit.y, hit.z), 'hit block is breakable');
    world.setBlock(hit.x, hit.y, hit.z, 'AIR');
    assert(world.getBlock(5, 20, 5) === 0, 'mined block via raycast target is gone');
  }
}

// --- raycast does not hit air / water as mineable ---
{
  // High in the sky so natural terrain cannot block the line of sight
  const y = 50;
  for (let z = 0; z <= 12; z++) {
    world.setBlock(8, y, z, 'AIR');
  }
  world.setBlock(8, y, 6, 'WATER');
  world.setBlock(8, y, 10, 'STONE');
  const origin = new THREE.Vector3(8.5, y + 0.5, 0.5);
  const dir = new THREE.Vector3(0, 0, 1);
  const hit = world.raycast(origin, dir, 14);
  assert(!!hit && hit.z === 10 && hit.x === 8, `raycast skips water and hits stone (got ${hit && `${hit.x},${hit.y},${hit.z}`})`);
}

// --- numeric id setBlock works (multiplayer path) ---
{
  assert(world.setBlock(1, 30, 1, BlockTypes.COBBLESTONE.id) === true, 'setBlock by numeric id');
  assert(world.getBlock(1, 30, 1) === BlockTypes.COBBLESTONE.id, 'numeric id stored');
}

if (failures > 0) {
  console.error(`\n${failures} TEST(S) FAILED`);
  process.exit(1);
}
console.log('\nALL EDIT TESTS PASSED');
