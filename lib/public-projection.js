'use strict';

const crypto = require('crypto');

// Stable, non-PII identifier for a ninja: a short hash of the Discord username.
// Gives frontends a guaranteed-unique key (ranking maps, React keys, dedup) without
// exposing the handle. Deterministic — the same username always maps to the same id.
// Computed BEFORE `u` is stripped from the public record (see projectStudent).
function stableId(u) {
  return crypto.createHash('sha1').update(String(u || '')).digest('hex').slice(0, 12);
}

// Map inconsistent loc values (abbreviations / cities / regions) to full country names.
// Anything not listed falls through unchanged (already-full names like "Germany", "Italy").
const LOC_MAP = {
  US: 'United States', USA: 'United States', NY: 'United States', LA: 'United States',
  'S. California': 'United States', 'S California': 'United States',
  UK: 'United Kingdom', London: 'United Kingdom', Scotland: 'United Kingdom',
  'Wales, UK': 'United Kingdom', Wales: 'United Kingdom', England: 'United Kingdom',
  'Perth, AU': 'Australia', Melbourne: 'Australia',
  Montreal: 'Canada',
  'South France': 'France',
  'S. Africa': 'South Africa',
  NZ: 'New Zealand',
  'Tunisia / Germany': 'Tunisia', // multi-country → canonical (matches the existing flag)
};

function normalizeLoc(loc) {
  const t = String(loc || '').trim();
  if (!t) return '';
  return LOC_MAP[t] || t;
}

// Build ONE public student record from a source record.
// roles: the roles.json map keyed by Discord username (`u`).
// IMPORTANT ORDERING: read `u` for the roles lookup, THEN omit `u` from the output (privacy).
function projectStudent(s, roles) {
  const rec = {
    id: stableId(s.u),                       // stable, non-PII key (hash of username)
    name: s.name,
    loc: normalizeLoc(s.loc),
    clips: s.clips || 0,
    comments: s.comments || 0,
    tech: s.tech || 0,
    lounge: s.lounge || 0,
    qwei: s.qwei || 0,
    hall: s.hall || 0,
    sentinel: s.sentinel || 0,
    startBpm: s.startBpm ?? null,
    highBpm: s.highBpm ?? null,
    currentBpm: s.currentBpm ?? null,
    active: !!s.active,
    join: s.join || null,
  };
  const role = roles && roles[s.u];        // lookup by username BEFORE it is dropped
  if (role) rec.roles = role;              // absent = no role (no empty field)
  return rec;                              // `u` intentionally omitted from public output
}

function buildPublicStudents(students, roles) {
  return students.map(s => projectStudent(s, roles || {}));
}

module.exports = { LOC_MAP, normalizeLoc, projectStudent, buildPublicStudents, stableId };
