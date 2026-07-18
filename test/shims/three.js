
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
