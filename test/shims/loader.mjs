
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: "file:///home/preston/Desktop/Blockworld/test/shims/three.js", shortCircuit: true };
  if (specifier === 'three/addons/utils/BufferGeometryUtils.js') return { url: "file:///home/preston/Desktop/Blockworld/test/shims/three-addons-utils.js", shortCircuit: true };
  return next(specifier, context);
}
