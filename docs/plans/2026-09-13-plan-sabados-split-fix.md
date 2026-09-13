# Plan — Fix Saturday commission split (Sep-12 incident)

> Date: 2026-09-13 · Incident: Saturday 2026-09-12 had **no row** in `comision_designacion_diaria`, so the 1.5%/0.5% split never fired. Designation saved Fri 11-sep 16:40 VE landed on **Sep-19** instead of Sep-12. ~$0.32 mis-assigned across 3 dispatches. Control case Sep-05 (designation existed) proves the split math is correct.

## Root cause (verified)

`PanelDesignacion` (`src/views/ComisionesView.jsx`) computes its default date with:

```js
const dias = (6 - d.getDay() + 7) % 7      // always walks FORWARD to next Saturday
d.setDate(d.getDate() + dias)
return d.toISOString().slice(0, 10)         // UTC shift at VE evenings
```

Two defects: (a) it never proposes the *current* Saturday, (b) `toISOString()` can shift the date at VE night hours. Result: designation saved Friday evening targeted the wrong Saturday.

## Objectives

1. **R1** — Repair the 3 mis-computed commission rows of Sep-12 (#3137, #3138, #3142): owner rows to 1.5%, designado (Edgar) row born at 0.5%.
2. **R2** — Fix the designation panel: correct default date (VE-safe, most recent/current Saturday) + explicit confirmation guard before saving a non-obvious Saturday.
3. **R3** — Nightly auditor watch **W3**: Saturday with eligible delivered sales but no designation row → webhook alert (warning-only).
4. **R4** — Docs + local commits. **No push without explicit user request** (standing rule).

## Guardrails (all phases)

- Read-only until explicit `--apply`; dry-run first, byte-identical backup before any write.
- Repair aborts if: any target row has `montopagado > 0` or `estado <> 'generada'`; `actualizadoen`/evidence mismatch vs snapshot; config split params differ from `0.50/1.50/dias='6'`; target row count ≠ 3.
- Both-tree parity diff for every frontend change; Vitest for the date helper usage.
- Audit-trail entry inserted for the repair (`COMISION_SPLIT_REPAIR` with full evidence in `meta`).
- Rollback: restore original values from the backup file (single script, same pattern as FIX-C #2185).

## Phase 0 — Baseline (read-only)

- Dump the 3 commission rows with full `calculo_evidencia` (bases `base_cabilla_usd`, `base_otros_usd`, fraction) + seller rows + config → `tmp/r14/sabado-12sep-backup.json`.
- Snapshot expected math: Niki $0.21 (#3137) / $0.51 (#3138); Josué $0.25 (#3142); Edgar $0.07 / $0.17 / $0.08 (0.5% of stored bases × payment fraction).

## Phase 1 — Data repair (main DB, staging-validated SQL shape)

- Validate the exact UPDATE/INSERT statements first against a **synthetic replica row in staging** (schema parity, guards exercised), then dry-run against main, then `--apply`.
- For each of the 3 dispatches:
  - UPDATE owner row: `totalcomision`/`comision_liberada` = round(base × 1.5% × fraction, 2); `pctcabilla`/`pctotros` = 1.50; evidence += `split_designado:true, split_repair:'2026-09-12-sin-designacion'`.
  - INSERT designado row (Edgar) at 0.5% with same bases; `ON CONFLICT (despachoid, vendedorid) DO NOTHING`; pre-check to avoid duplicates.
- Insert `auditoria` row with before/after JSON + backup file reference.
- Verify post-apply: invariant `cab+otros = total` per row; lib+ret = total; auditor section-2 queries green; no other rows touched.

## Phase 2 — Designation panel fix (both trees: `src/` + `construacero-staging/src/`)

- Reuse the existing helper `getUltimoSabadoRange(0)` from `dateHelpers.js` (already local-date safe, "most recent Saturday, today if Saturday") as the panel default instead of the broken IIFE.
- Add explicit confirmation when the selected date is not the current/next Saturday, and show "Aplicará SOLO a despachos creados el sábado DD-mes" in the save button area.
- Add/extend Vitest: default date = most recent Saturday in local time (covers the 20:00+ VE edge).
- Parity diff both trees after patch.

## Phase 3 — Auditor W3 watch

- Extend `scripts/auditor-saldos-main.mjs` (Section 2): W3 = last 30 days' Saturdays with ≥1 eligible delivered dispatch (same eligibility rules as W1) **and** no `comision_designacion_diaria` row for that date → warning detail with dispatch numbers. Warning-only (same tier as W1/W2); the existing nightly workflow + webhook needs no change.

## Phase 4 — Verification, docs, commits

- Re-run auditor locally (expect W3 clean for Sep-12 after repair; Sep-19 designation exists).
- CHANGELOG (Unreleased) + BITACORA session entry + matriz-migraciones note (data repair + UI fix, no schema migration).
- Local commits only; **no push**.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Overwriting a paid/locked commission | Abort if `montopagado > 0` or `estado <> 'generada'` |
| Bases drifted since snapshot | `actualizadoen` + evidence-base sum checks before write |
| Split config changed | Re-read config; abort if ≠ 0.50/1.50/dias 6 |
| Duplicate designado row | Pre-check + `ON CONFLICT DO NOTHING` |
| Wrong-Saturday mistake repeats | W3 nightly alert + panel default fix + confirmation guard |
| Frontend regression | Both-tree parity diff + Vitest + staging smoke |

## Sequencing

Phase 0 → 1 → 2 → 3 → 4, single session. Deliverables: repaired rows, fixed panel (both trees), W3 alert, docs, local commits.
