import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {
    chain: "llm-rag",
    llm: "mock",
    rag: "sqlite",
    seed: "probe",
    input: "",
    assert: [],
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "json") {
      out.json = true;
      continue;
    }
    const value = argv[i + 1] ?? "";
    i += 1;
    if (key === "assert") {
      out.assert = value.split(/[,\s]+/).map((v) => v.trim()).filter(Boolean);
    } else {
      out[key] = value;
    }
  }

  if (!out.input) {
    out.input = "今天有哪些任务？请结合番茄工作法给我一个时间管理建议";
  }

  return out;
}

function loadDotEnv(file) {
  if (!existsSync(file)) return {};
  const env = {};
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const args = parseArgs(process.argv.slice(2));
const dotenv = loadDotEnv(path.join(root, ".env"));
const vitestBin = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vitest.CMD" : "vitest",
);

const child = spawnSync(
  vitestBin,
  [
    "run",
    "src/agent/probe/agentProbe.test.ts",
    "--reporter=dot",
    "--silent=false",
  ],
  {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...dotenv,
      VITE_AGENT_PROBE_ARGS: JSON.stringify(args),
    },
  },
);

const stdout = child.stdout ?? "";
const stderr = child.stderr ?? "";
const marker = "__AGENT_PROBE_RESULT__";
const line = stdout.split(/\r?\n/).find((item) => item.includes(marker));
const jsonText = line ? line.slice(line.indexOf(marker) + marker.length).trim() : "";

if (args.json && jsonText) {
  try {
    const parsed = JSON.parse(jsonText);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(jsonText);
  }
} else {
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}

if (child.status !== 0) {
  if (child.error) {
    console.error(child.error.message);
  }
  if (args.json && !jsonText) {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
  }
  process.exit(child.status ?? 1);
}
