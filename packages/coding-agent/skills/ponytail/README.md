# Ponytail skills (vendored)

Six skills from [Ponytail](https://github.com/DietrichGebert/ponytail) (MIT, DietrichGebert),
vendored at `ebd8654c2c627f721eb8f9c0d1bd4090a29f9e10`:

- `ponytail` — lazy senior dev ruleset (lite / full / ultra)
- `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`, `ponytail-review`

Invoke with `skill:ponytail` (or say "ponytail", "be lazy", "simplest solution").
The upstream text still names its original host's `/ponytail ...` commands; here,
request the level in prose (lite, full, ultra) or say "stop ponytail" to leave the mode.

Refresh from a clean upstream checkout:

```sh
git clone --depth 1 https://github.com/DietrichGebert/ponytail.git /tmp/ponytail
node scripts/sync-external-skills.mjs --source-ponytail /tmp/ponytail
node scripts/sync-external-skills.mjs --check
```
