import fs from "fs";
import path from "path";

const SRC = path.resolve("src/server");
const ALLOWED_DIR = path.join(SRC, "db");

const DB_PATTERNS = [/\bdb\.(select|insert|update|delete)\b/, /\bdb\.query\b/, /from\s*\(\s*schema\./];

function lint(): number {
  let violations = 0;

  const files = getAllTsFiles(SRC).filter((f) => !f.startsWith(ALLOWED_DIR));

  for (const file of files) {
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    lines.forEach((line, i) => {
      if (line.includes("// lint-ignore")) return;
      for (const pattern of DB_PATTERNS) {
        if (pattern.test(line)) {
          console.error(
            `${file}:${i + 1}: direct DB query outside db/ layer — use db/queries.ts instead`,
          );
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
