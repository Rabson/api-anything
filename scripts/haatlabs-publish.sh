#!/usr/bin/env bash
# Publish this checkout to GitHub Packages as @haatlabs/api-anything, version
# <upstream version>-haatlabs.<N> (N = $1). package.json keeps upstream's name and version in
# git, so upstream's distribution tests and merges stay clean; the rename exists only in the
# packed copy. Needs NODE_AUTH_TOKEN (a token that can write the Haatlabs org's packages).
set -euo pipefail
n="${1:?usage: scripts/haatlabs-publish.sh <haatlabs build number>}"
[[ "$n" =~ ^[0-9]+$ ]] || { echo "build number must be digits: $n" >&2; exit 1; }
: "${NODE_AUTH_TOKEN:?set NODE_AUTH_TOKEN}"
[ -z "$(git status --porcelain)" ] || { echo "the checkout has uncommitted changes" >&2; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cd "$root"
npm run build
tarball="$(npm pack --silent --pack-destination "$work")"
tar -xzf "$work/$tarball" -C "$work"
node -e '
const fs = require("fs"); const f = process.argv[1]; const n = process.argv[2];
const p = JSON.parse(fs.readFileSync(f, "utf8"));
p.name = "@haatlabs/api-anything";
p.version = `${p.version}-haatlabs.${n}`;
p.publishConfig = { registry: "https://npm.pkg.github.com" };
p.repository = { type: "git", url: "git+https://github.com/Haatlabs/api-anything.git" };
delete p.scripts.prepare; delete p.scripts.prepublishOnly;
fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
console.log(`publishing ${p.name}@${p.version}`);' "$work/package/package.json" "$n"
printf '%s\n' '@haatlabs:registry=https://npm.pkg.github.com' '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}' > "$work/package/.npmrc"
cd "$work/package"
npm publish --ignore-scripts --tag haatlabs
