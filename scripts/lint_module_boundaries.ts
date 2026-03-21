import fs from "fs";
import path from "path";

const SRC = path.resolve("src/server");

interface Rule {
  /** Glob-like path prefix within src/server/ */
  files: string;
  /** Import paths that are forbidden in those files */
  forbiddenImports: string[];
  /** Human-readable reason */
  reason: string;
}

const RULES: Rule[] = [
  {
    files: "google/",
    forbiddenImports: [
      "./db",
      "../db",
      "../../db",
      "./routes",
      "../routes",
      "../../routes",
      "./agent",
      "../agent",
      "../../agent",
      "./tools",
      "../tools",
      "../../tools",
      "./email",
      "../email",
      "../../email",
    ],
    reason: "Connectors are infrastructure — they must not import application logic or data layer",
  },
  {
    files: "db/",
    forbiddenImports: [
      "./google",
      "../google",
      "../../google",
      "./routes",
      "../routes",
      "../../routes",
      "./agent",
      "../agent",
      "../../agent",
      "./tools",
      "../tools",
      "../../tools",
    ],
    reason: "Data layer must not import connectors, routes, or application logic",
  },
  {
    files: "tools.ts",
    forbiddenImports: ["./routes", "../routes", "./agent", "../agent"],
    reason: "Tool handlers should only use db/queries and google/* connectors",
  },
  {
    files: "routes.ts",
    forbiddenImports: ["./tools", "../tools", "./agent", "../agent"],
    reason: "Routes are peers with tools — neither should depend on the other",
  },
];

function lint(): number {
  let violations = 0;

  for (const rule of RULES) {
    const target = path.join(SRC, rule.files);

    if (!fs.existsSync(target)) continue;

    const files = fs.statSync(target).isDirectory()
      ? fs
          .readdirSync(target, { recursive: true })
          .filter((f): f is string => typeof f === "string" && f.endsWith(".ts"))
          .map((f) => path.join(target, f))
      : [target];

    for (const file of files) {
      const lines = fs.readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        if (!line.match(/^\s*(import|from)\s/)) return;
        if (line.includes("// lint-ignore")) return;
        for (const forbidden of rule.forbiddenImports) {
          if (line.includes(forbidden)) {
            console.error(`${file}:${i + 1}: forbidden import "${forbidden}" — ${rule.reason}`);
            violations++;
          }
        }
      });
    }
  }

  return violations;
}

process.exit(lint() > 0 ? 1 : 0);
