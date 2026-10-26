// The first screen's JavaScript budget (board #511, S-3): what a browser downloads before the first screen can render.

/**
 * The files of the entry (`index.html`) and of the given screen modules, with everything they import statically.
 * Dynamic imports are left out: they load later, when something renders them.
 * @param {Record<string, {file: string, isEntry?: boolean, imports?: string[]}>} manifest Vite's .vite/manifest.json
 * @param {string[]} screens source paths of the first screen's lazy modules, as the manifest keys them
 */
export function firstScreenFiles(manifest, screens) {
  const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry);
  for (const screen of screens) {
    if (!manifest[screen]) throw new Error(`${screen} is not a chunk in the build's manifest. Was it renamed?`);
  }
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const imported of manifest[key].imports ?? []) visit(imported);
  };
  for (const key of [...entries, ...screens]) visit(key);
  return [...new Set([...seen].map((key) => manifest[key].file))];
}

/**
 * @param {string[]} files
 * @param {(file: string) => number} sizeOf compressed bytes of one file
 * @param {number} budgetKiB
 */
export function checkBudget(files, sizeOf, budgetKiB) {
  const sized = files.map((file) => ({ file, bytes: sizeOf(file) })).sort((a, b) => b.bytes - a.bytes);
  const totalKiB = sized.reduce((sum, f) => sum + f.bytes, 0) / 1024;
  return { ok: totalKiB <= budgetKiB, totalKiB, files: sized };
}
