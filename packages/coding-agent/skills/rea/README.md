# REA skill (vendored)

`reverse-engineer-anything` from [REA](https://github.com/sgunin/reverseengineeranything)
(MIT, morluto), vendored at `92617f965720aaa74ec20ad67291adc5e83677a1`.

REA is a reverse-engineering MCP server and CLI. The skill's tools are provided by
that server, so register it before use:

```sh
npx rea-agents@latest setup
# or register the server manually:
# npx -y rea-agents@<version> mcp
```

The skill includes the readiness check and the setup/escalation rules. Refresh:

```sh
git clone --depth 1 https://github.com/sgunin/reverseengineeranything.git /tmp/rea
node scripts/sync-external-skills.mjs --source-rea /tmp/rea
node scripts/sync-external-skills.mjs --check
```
