#!/bin/sh
# Claude Code PreToolUse hook. Blocks Edit/Write of a test that already
# exists on the protected branch. The agent can still change this file;
# CI on the protected branch is the enforcement boundary.
input=$(cat)
file=$(printf '%s' "$input" | node --input-type=module -e '
import fs from "node:fs"
const raw = fs.readFileSync(0, "utf8")
let path = ""
try {
  const body = JSON.parse(raw)
  path = body.tool_input?.file_path || body.tool_input?.path || ""
} catch {
  path = ""
}
process.stdout.write(String(path))
')
if [ -z "$file" ]; then
  exit 0
fi
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
case "$file" in
  "$root"/*) file=${file#"$root"/} ;;
esac
exec npx --no-install vibecheck protected --file "$file"
