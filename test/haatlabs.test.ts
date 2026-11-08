// What haatlabs site-api relies on from this package: tier 1 sends every request through the
// caller's fetchImpl (how it reaches the proxy pool), a tier-1 call never loads Playwright (its
// image has no browser), and a spec saved in the home wins over the bundled one of that name.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { call } from "../src/execute.js";
import { parseSite } from "../src/spec.js";
import { loadSite, saveSite } from "../src/store.js";

const HOME = mkdtempSync(join(tmpdir(), "api-anything-haatlabs-"));
process.env.API_ANYTHING_HOME = HOME;
after(() => rmSync(HOME, { recursive: true, force: true }));

const site = (name: string, url: string) =>
  parseSite({
    name,
    baseUrl: new URL(url).origin,
    operations: [
      {
        name: "item",
        readOnly: true,
        request: { method: "GET", url, headers: {} },
        slots: [{ param: "id", at: ["query:id"] }],
        trigger: { url: `${new URL(url).origin}/item/{id}` },
        params: [{ name: "id" }],
        response: { extract: "item" },
      },
    ],
  });

test("tier 1 sends every request, redirect hops included, through fetchImpl", async () => {
  saveSite(site("hl", "https://hl.test/api/item?id=1"));
  const seen: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    if (url.startsWith("https://hl.test/api/item"))
      return new Response(null, { status: 302, headers: { location: "https://hl.test/v2/item?id=7" } });
    return new Response(JSON.stringify({ item: { id: 7, name: "seven" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const r = await call("hl", "item", { id: "7" }, { maxTier: 1, fetchImpl, minIntervalMs: 0 });
  assert.equal(r.ok, true, r.reason ?? "");
  assert.deepEqual(r.data, { id: 7, name: "seven" });
  assert.deepEqual(seen, ["https://hl.test/api/item?id=7", "https://hl.test/v2/item?id=7"]);
});

test("a tier-1 call never loads playwright-core", () => {
  const dir = mkdtempSync(join(tmpdir(), "api-anything-nobrowser-"));
  try {
    const hooks = join(dir, "hooks.mjs");
    writeFileSync(
      hooks,
      `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("playwright")) throw new Error("PLAYWRIGHT LOADED: " + specifier);
  return next(specifier, context);
} });`,
    );
    const script = join(dir, "run.mts");
    const src = fileURLToPath(new URL("../src/", import.meta.url));
    writeFileSync(
      script,
      `import { call } from ${JSON.stringify(join(src, "execute.ts"))};
import { parseSite } from ${JSON.stringify(join(src, "spec.ts"))};
import { saveSite } from ${JSON.stringify(join(src, "store.ts"))};
saveSite(parseSite(${JSON.stringify(site("nb", "https://nb.test/api/item?id=1"))}));
const fetchImpl = async () => new Response(JSON.stringify({ item: { ok: 1 } }), { headers: { "content-type": "application/json" } });
const r = await call("nb", "item", { id: "2" }, { maxTier: 1, fetchImpl, minIntervalMs: 0 });
console.log(JSON.stringify({ ok: r.ok, class: r.class, reason: r.reason }));`,
    );
    const out = spawnSync(process.execPath, ["--import", "tsx", "--import", hooks, script], {
      encoding: "utf8",
      env: { ...process.env, API_ANYTHING_HOME: join(dir, "home"), API_ANYTHING_BROWSER: "/nonexistent" },
    });
    assert.equal(out.status, 0, out.stderr);
    assert.doesNotMatch(out.stdout + out.stderr, /PLAYWRIGHT LOADED/);
    assert.equal(JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "{}").ok, true, out.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a spec saved in the home wins over the bundled one", () => {
  const bundled = loadSite("hacker-news");
  assert.ok(bundled, "hacker-news is bundled");
  assert.notEqual(bundled.source, "home");
  saveSite({ ...bundled.site, description: "haatlabs copy" });
  const mine = loadSite("hacker-news");
  assert.equal(mine?.site.description, "haatlabs copy");
});
