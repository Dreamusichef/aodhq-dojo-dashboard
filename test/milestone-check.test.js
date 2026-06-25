'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPulseOps } = require('../lib/pulse-ops');

// --- temp workspace -------------------------------------------------------
let tmp, dataFile, pulseStateFile;

function writeData(totalAcross) {
  // Two students whose clips sum to `totalAcross`; no clip_timestamps so
  // reconcileClips leaves counts untouched.
  const half = Math.floor(totalAcross / 2);
  const data = {
    meta: { totalClips: totalAcross },
    students: [
      { u: 'a', name: 'A', loc: 'Italy', clips: half },
      { u: 'b', name: 'B', loc: 'US', clips: totalAcross - half },
    ],
  };
  fs.writeFileSync(dataFile, JSON.stringify(data), 'utf8');
}

function writeState(state) {
  fs.writeFileSync(pulseStateFile, JSON.stringify(state), 'utf8');
}

function readState() {
  return JSON.parse(fs.readFileSync(pulseStateFile, 'utf8'));
}

function makeOps() {
  return createPulseOps({
    paths: { dataFile, pulseStateFile },
    discord: { guildId: 'g1', channels: { notify: 'notify-chan', pulseName: 'dojo-pulse', practiceVideos: 'pv' } },
    dryRun: false,
  });
}

// Fake discord client. `failSend` makes the notify-channel fetch reject, simulating
// a real-world ping failure (channel gone, missing perms, transient 5xx).
function fakeClient({ failSend = false } = {}) {
  const calls = { sends: 0 };
  return {
    calls,
    guilds: { fetch: async () => ({ ownerId: 'owner1' }) },
    channels: {
      fetch: async () => {
        if (failSend) throw new Error('Unknown Channel (simulated)');
        return { send: async () => { calls.sends++; } };
      },
    },
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestone-'));
  dataFile = path.join(tmp, 'dojo-data.json');
  pulseStateFile = path.join(tmp, 'pulse-state.json');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('runMilestoneCheck — disarm is decoupled from the owner ping', () => {
  it('records last_milestone even when the owner ping FAILS (the repeated-flourish bug)', async () => {
    writeData(2000);
    writeState({ last_milestone: 0 });

    const ops = makeOps();
    const client = fakeClient({ failSend: true });

    // Must not throw — the failure is caught internally.
    await ops.runMilestoneCheck(client);

    // The whole point: the milestone is disarmed so the digest flourish won't repeat.
    assert.strictEqual(readState().last_milestone, 2000);
    assert.strictEqual(client.calls.sends, 0);
  });

  it('pings the owner and records the milestone on the happy path', async () => {
    writeData(2000);
    writeState({ last_milestone: 0 });

    const ops = makeOps();
    const client = fakeClient();
    await ops.runMilestoneCheck(client);

    assert.strictEqual(client.calls.sends, 1);
    assert.strictEqual(readState().last_milestone, 2000);
  });

  it('is idempotent — an already-recorded milestone neither pings nor rewrites', async () => {
    writeData(2014);                 // still inside the 2,000 band
    writeState({ last_milestone: 2000 });

    const ops = makeOps();
    const client = fakeClient();
    await ops.runMilestoneCheck(client);

    assert.strictEqual(client.calls.sends, 0);
    assert.strictEqual(readState().last_milestone, 2000);
  });

  it('does nothing below the 2,000 floor', async () => {
    writeData(1500);
    writeState({ last_milestone: 0 });

    const ops = makeOps();
    const client = fakeClient();
    await ops.runMilestoneCheck(client);

    assert.strictEqual(client.calls.sends, 0);
    assert.strictEqual(readState().last_milestone, 0);
  });

  it('arms the NEXT band (3,000) once the total crosses it', async () => {
    writeData(3000);
    writeState({ last_milestone: 2000 });

    const ops = makeOps();
    const client = fakeClient();
    await ops.runMilestoneCheck(client);

    assert.strictEqual(client.calls.sends, 1);
    assert.strictEqual(readState().last_milestone, 3000);
  });
});
