'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { flag, formatLine } = require('../lib/rankings-gen');
const { LOC_MAP, normalizeLoc } = require('../lib/public-projection');

const BLANK = '\u{1f3f3}\u{fe0f}';

describe('ninja-rankings country flags', () => {
  it('resolves the countries that previously rendered blank', () => {
    // These had no FLAGS entry, so Discord showed 🏳️ while the dashboard showed the
    // country name — the two surfaces disagreed.
    assert.strictEqual(flag('Canada'), '🇨🇦');
    assert.strictEqual(flag('Sweden'), '🇸🇪');
    assert.strictEqual(flag('Indonesia'), '🇮🇩');
    assert.strictEqual(flag('Belgium'), '🇧🇪');
    assert.strictEqual(flag('Poland'), '🇵🇱');
  });

  it('still resolves the legacy raw values stored in dojo-data.json', () => {
    for (const raw of ['US', 'UK', 'NY', 'LA', 'Montreal', 'S. Africa', 'NZ',
      'Scotland', 'London', 'Perth, AU', 'Melbourne', 'S. California',
      'South France', 'Wales, UK', 'Tunisia / Germany']) {
      assert.notStrictEqual(flag(raw), BLANK, `legacy loc "${raw}" lost its flag`);
    }
  });

  it('raw and canonical spellings of the same place give the SAME flag', () => {
    // The invariant that keeps Discord and the dashboard in agreement: whatever
    // normalizeLoc turns a raw value into must carry the identical flag.
    for (const raw of Object.keys(LOC_MAP)) {
      const canonical = normalizeLoc(raw);
      assert.strictEqual(
        flag(raw), flag(canonical),
        `"${raw}" -> "${canonical}" flag mismatch (${flag(raw)} vs ${flag(canonical)})`
      );
      assert.notStrictEqual(flag(raw), BLANK, `"${raw}" has no flag`);
    }
  });

  it('falls back to a blank flag for missing/unknown values without throwing', () => {
    assert.strictEqual(flag(''), BLANK);
    assert.strictEqual(flag(null), BLANK);
    assert.strictEqual(flag(undefined), BLANK);
    assert.strictEqual(flag('Atlantis'), BLANK);
  });

  it('renders a ranking line with the flag inline', () => {
    const line = formatLine(3, 'Joss', 23, 'Sweden', true);
    assert.match(line, /🇸🇪/);
    assert.match(line, /\*\*Joss\*\*/);
    assert.match(line, /23 vids/);
  });
});
