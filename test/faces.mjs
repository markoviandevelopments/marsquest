// Verifies that an isolated block emits all 6 faces (no missing faces),
// and that a transparent block next to an opaque block still shows its face.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const three = `
class Vector3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;} clone(){return new Vector3(this.x,this.y,this.z);} add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;} sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;} multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;} normalize(){const l=Math.hypot(this.x,this.y,this.z)||1;this.x/=l;this.y/=l;this.z/=l;return this;} crossVectors(a,b){this.x=a.y*b.z-a.z*b.y;this.y=a.z*b.x-a.x*b.z;this.z=a.x*b.y-a.y*b.x;return this;} lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;} applyMatrix3(){return this;} applyMatrix4(){return this;} }
class Vector2 { constructor(x=0,y=0){this.x=x;this.y=y;} }
class Matrix3 { getNormalMatrix(){return this;} }
class Matrix4 { lookAt(){return this;} }
class Color { constructor(c){this.c=c;} }
class Scene { constructor(){this.children=[];} add(o){this.children.push(o);} remove(o){const i=this.children.indexOf(o);if(i>=0)this.children.splice(i,1);} }
class PerspectiveCamera { constructor(){this.position=new Vector3();this.matrixWorld={};} getWorldDirection(v){v.set(0,0,-1);return v;} updateProjectionMatrix(){} }
class WebGLRenderer { constructor(){this.domElement={addEventListener(){}};} setSize(){} setPixelRatio(){} render(){} }
class Fog { constructor(){} }
class AmbientLight { constructor(){} }
class DirectionalLight { constructor(){this.position=new Vector3();this.shadow={mapSize:{},camera:{}};} }
class MeshLambertMaterial { constructor(o){Object.assign(this,o);} dispose(){} }
class Mesh { constructor(g,m){this.geometry=g;this.material=m;this.userData={};this.castShadow=false;this.receiveShadow=false;} }
class BufferGeometry { constructor(){this.attributes={};this.index=null;} setAttribute(n,a){this.attributes[n]=a;} setIndex(i){this.index=i;} dispose(){} }
class BufferAttribute { constructor(a,n){this.array=a;this.itemSize=n;} }
class Float32BufferAttribute { constructor(a,n){this.array=a;this.itemSize=n;} }
const FrontSide=0, DoubleSide=2;
class DataTexture { constructor(){ this.needsUpdate=false; this.magFilter=0; this.minFilter=0; this.generateMipmaps=false; this.flipY=true; this.colorSpace=''; } }
class CanvasTexture extends DataTexture {}
const NearestFilter=1003, SRGBColorSpace='srgb';
const THREE = { Vector3, Vector2, Matrix3, Matrix4, Color, Scene, PerspectiveCamera, WebGLRenderer, Fog, AmbientLight, DirectionalLight, MeshLambertMaterial, Mesh, BufferGeometry, BufferAttribute, Float32BufferAttribute, FrontSide, DoubleSide, DataTexture, CanvasTexture, NearestFilter, SRGBColorSpace };
export default THREE; export { Vector3, Vector2, Matrix3, Matrix4, Color, Scene, PerspectiveCamera, WebGLRenderer, Fog, AmbientLight, DirectionalLight, MeshLambertMaterial, Mesh, BufferGeometry, BufferAttribute, Float32BufferAttribute, FrontSide, DoubleSide, DataTexture, CanvasTexture, NearestFilter, SRGBColorSpace };
`;
const bgu = `
// Mock that actually concatenates face positions so face counts are real.
export const mergeGeometries = (geos) => {
  if (!geos || geos.length === 0) return null;
  const merged = { attributes: { position: { array: [] }, color: { array: [] }, uv: { array: [] } }, index: null };
  for (const g of geos) {
    merged.attributes.position.array.push(...g.attributes.position.array);
    merged.attributes.color.array.push(...g.attributes.color.array);
    merged.attributes.uv.array.push(...g.attributes.uv.array);
  }
  return merged;
};
`;
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

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('ok:', msg); }
  else { console.error('FAIL:', msg); failures++; }
}

// --- Test 1: isolated opaque block emits all 6 faces ---
{
  const scene = new THREE.Scene();
  const world = new World(scene);
  const chunk = world.getOrCreateChunk(0, 0);
  chunk.blocks.fill(0);
  chunk.setBlock(8, 20, 8, 3); // STONE, isolated
  chunk.dirty = true;
  chunk.rebuildMesh();
  const pos = chunk.mesh.geometry.attributes.position.array;
  const faceCount = pos.length / (4 * 3); // 4 verts per face
  assert(faceCount === 6, `isolated block emits 6 faces (got ${faceCount})`);
}

// --- Test 2: transparent block (glass) next to opaque block still shows its face ---
{
  const scene = new THREE.Scene();
  const world = new World(scene);
  const chunk = world.getOrCreateChunk(0, 0);
  chunk.blocks.fill(0);
  chunk.setBlock(8, 20, 8, 3);  // STONE (opaque)
  chunk.setBlock(9, 20, 8, 9);  // GLASS (transparent) adjacent on +X
  chunk.dirty = true;
  chunk.rebuildMesh();
  // Glass block: its -X face touches opaque stone -> hidden. Other 5 faces shown.
  // We can't easily attribute faces to a block here, so just assert the chunk
  // produced a transparent mesh with geometry (glass faces were emitted).
  const hasTransparent = !!chunk.transparentMesh && chunk.transparentMesh.geometry.attributes.position.array.length > 0;
  assert(hasTransparent, 'transparent block adjacent to opaque block still emits faces');
}

if (failures > 0) { console.error(`\n${failures} TEST(S) FAILED`); process.exit(1); }
console.log('\nALL FACE TESTS PASSED');
