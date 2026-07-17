import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const productionRoots = ["src", "packages/comment-field-engine/src", "packages/comment-field-webgpu-runtime/src"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);
const moduleExtensions = [".ts", ".tsx", ".js", ".jsx"];
const failures = [];

function filesUnder(folder) {
  const absolute = resolve(root, folder);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(absolute, entry.name);
    return entry.isDirectory() ? filesUnder(relative(root, path)) : [path];
  });
}

const productionFiles = productionRoots.flatMap(filesUnder)
  .filter((file) => sourceExtensions.has(extname(file)) && !file.endsWith(".d.ts"));
const testFiles = filesUnder("tests").filter((file) => moduleExtensions.includes(extname(file)));
const moduleFiles = [...productionFiles, ...testFiles].filter((file) => moduleExtensions.includes(extname(file)));

for (const file of [...productionFiles, ...testFiles]) {
  const repoPath = relative(root, file).replaceAll("\\", "/");
  const limit = repoPath.startsWith("tests/") ? 500 : 400;
  const lines = readFileSync(file, "utf8").split(/\r?\n/).length;
  if (lines > limit) failures.push(`${relative(root, file)} has ${lines} lines; limit is ${limit}`);
}

const importPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
const graph = new Map();
for (const file of moduleFiles) {
  const text = readFileSync(file, "utf8");
  const sources = [...text.matchAll(importPattern)].map((match) => match[1]);
  const repoPath = relative(root, file).replaceAll("\\", "/");
  if (repoPath.startsWith("packages/comment-field-engine/src/")) {
    for (const source of sources) if (!source.startsWith(".")) failures.push(`${repoPath} imports forbidden engine dependency ${source}`);
    if (/\b(document|window|navigator|HTMLElement|HTMLCanvasElement|requestAnimationFrame)\b/.test(text)) failures.push(`${repoPath} contains a browser runtime dependency`);
  }
  if (repoPath.startsWith("packages/comment-field-webgpu-runtime/src/")) {
    for (const source of sources) {
      if (source === "react" || source.startsWith("react/")) failures.push(`${repoPath} imports React`);
      if (source.includes("/src/") && !source.startsWith(".")) failures.push(`${repoPath} deep-imports ${source}`);
    }
  }
  if (repoPath.startsWith("src/")) {
    for (const source of sources) {
      if (source === "three" || source.startsWith("three/")) failures.push(`${repoPath} bypasses the WebGPU runtime with ${source}`);
      if (source.startsWith("@comment-field/") && source !== "@comment-field/engine" && source !== "@comment-field/webgpu-runtime") failures.push(`${repoPath} deep-imports ${source}`);
    }
  }
  graph.set(file, sources.filter((source) => source.startsWith(".")).map((source) => resolveModule(file, source)).filter(Boolean));
}

function resolveModule(importer, source) {
  const base = resolve(importer, "..", source);
  for (const candidate of [base, ...moduleExtensions.map((extension) => `${base}${extension}`), ...moduleExtensions.map((extension) => join(base, `index${extension}`))]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const visiting = new Set();
const visited = new Set();
function visit(file, path = []) {
  if (visiting.has(file)) {
    const start = path.indexOf(file);
    failures.push(`import cycle: ${path.slice(start).concat(file).map((item) => relative(root, item)).join(" -> ")}`);
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency, [...path, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of moduleFiles) visit(file);

const runtimeText = filesUnder("packages/comment-field-webgpu-runtime/src")
  .filter((file) => !file.endsWith(".d.ts")).map((file) => readFileSync(file, "utf8")).join("\n");
for (const token of ["WebGLRenderer", "WebGLRenderTarget", "ShaderMaterial", "vertexShader", "fragmentShader", "glslFn", ".glsl"]) {
  if (runtimeText.includes(token)) failures.push(`legacy graphics token remains in WebGPU runtime: ${token}`);
}
if (!runtimeText.includes("wgslFn") || !filesUnder("packages/comment-field-webgpu-runtime/src").some((file) => file.endsWith(".wgsl"))) {
  failures.push("WebGPU runtime must contain an explicit WGSL shader loaded through wgslFn");
}

if (failures.length) {
  console.error("Architecture verification failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`Architecture verified: ${productionFiles.length} production files, ${testFiles.length} test files, no boundary drift or cycles.`);
