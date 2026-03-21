// This CLI script uses sync fs — it only scans src/server/, not scripts/.
import fs from "fs";
import path from "path";

const SRC = path.resolve("src/server");

const BLOCKING_CALLS = [
  { pattern: /\breadFileSync\b/, fix: "fs.promises.readFile" },
  { pattern: /\bwriteFileSync\b/, fix: "fs.promises.writeFile" },
  { pattern: /\bexistsSync\b/, fix: "fs.promises.access" },
  { pattern: /\bmkdirSync\b/, fix: "fs.promises.mkdir" },
  { pattern: /\bexecSync\b/, fix: "child_process.exec (promisified)" },
  { pattern: /\bspawnSync\b/, fix: "child_process.spawn" },
  { pattern: /\bAtomics\.wait\b/, fix: "Atomics.waitAsync" },
];

function lint(): number {
  let violations = 0;

  for (const file of getAllTsFiles(SRC)) {
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split("\n");

    lines.forEach((line, i) => {
      if (line.includes("// lint-ignore")) return;
      for (const { pattern, fix } of BLOCKING_CALLS) {
        if (pattern.test(line)) {
          console.error(`${file}:${i + 1}: blocking call in server code — use ${fix} instead`);
          violations++;
        }
      }
    });
  }

  return violations;
}

function getAllTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((e) =>
    e.isDirectory()
      ? getAllTsFiles(path.join(dir, e.name))
      : e.name.endsWith(".ts")
        ? [path.join(dir, e.name)]
        : [],
  );
}

process.exit(lint() > 0 ? 1 : 0);
