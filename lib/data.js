'use strict';

const fs = require('fs');

function readJSON(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function reconcileClips(data, { writeFile = null, log = console.log } = {}) {
  let fixed = 0;
  for (const s of data.students) {
    const tsCount = (s.clip_timestamps || []).length;
    const declared = s.clips || 0;
    const correct = Math.max(declared, tsCount);
    if (correct !== declared) {
      s.clips = correct;
      fixed++;
    }
  }
  if (fixed > 0) {
    log(`[Reconcile] Fixed ${fixed} students' clip counts`);
    if (writeFile) writeJSON(writeFile, data);
  }
  return data;
}

function loadDojoData(dataFile) {
  const data = readJSON(dataFile);
  return reconcileClips(data, { writeFile: dataFile });
}

function writeBackClipTimestamps(liveData, dataFile, { log = console.log } = {}) {
  const data = readJSON(dataFile);
  const studentMap = {};
  for (const s of data.students) studentMap[s.u] = s;

  for (const clip of (liveData.clipTimestamps || [])) {
    const student = studentMap[clip.username];
    if (!student) continue;
    if (!student.clip_timestamps) student.clip_timestamps = [];
    if (!student.clip_timestamps.includes(clip.timestamp)) {
      student.clip_timestamps.push(clip.timestamp);
    }
  }

  writeJSON(dataFile, data);
  log('[WriteBack] Updated dojo-data.json with live clip timestamps');
  return data;
}

module.exports = {
  readJSON,
  writeJSON,
  reconcileClips,
  loadDojoData,
  writeBackClipTimestamps,
};
