import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baseline = JSON.parse(readFileSync(join(root, "eslint-baseline.json"), "utf8"));

const result = spawnSync("npx", ["eslint", ".", "-f", "json"], {
  cwd: root,
  encoding: "utf8",
});

if (!result.stdout) {
  console.error(result.stderr || "ESLint no produjo salida JSON.");
  process.exit(result.status || 1);
}

const report = JSON.parse(result.stdout);
const current = report.reduce(
  (acc, file) => {
    acc.errors += file.errorCount;
    acc.warnings += file.warningCount;
    if (file.errorCount || file.warningCount) acc.files += 1;
    return acc;
  },
  { errors: 0, warnings: 0, files: 0 },
);

const allowed = baseline.totals;
const passed =
  current.errors <= allowed.errors &&
  current.warnings <= allowed.warnings &&
  current.files <= allowed.files;

console.log(
  JSON.stringify(
    {
      current,
      allowed,
      passed,
      note:
        "Este comando controla que la deuda ESLint no aumente (totales y archivos con hallazgos); no fija distribución por regla ni por archivo: la deuda puede moverse entre archivos si el conteo global no sube. npm run lint sigue mostrando el detalle completo.",
    },
    null,
    2,
  ),
);

if (!passed) {
  process.exit(1);
}
