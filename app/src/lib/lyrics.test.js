// Run: npm test   (plain node, no framework)
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { wordStarts, lyricAt, validateLyrics } from './lyrics.js';

const line = { start: 10, end: 14, words: [{ t: 'a' }, { t: 'b' }, { t: 'c', start: 11 }, { t: 'd' }] };
assert.deepEqual(wordStarts(line), [10, 11, 11, 13]);

const lines = [{ ...line }, { start: 20, end: 22, words: [{ t: 'x' }, { t: 'y' }] }];
assert.deepEqual(lyricAt(lines, 0), { cur: 0, sung: 0 });     // before the first line
assert.deepEqual(lyricAt(lines, 11.5), { cur: 0, sung: 3 });
assert.deepEqual(lyricAt(lines, 17), { cur: 0, sung: 4 });    // gap between lines: keep last line fully sung
assert.deepEqual(lyricAt(lines, 21), { cur: 1, sung: 2 });
assert.deepEqual(lyricAt([], 5), { cur: -1, sung: 0 });

const sample = JSON.parse(readFileSync(new URL('../../../api/uploads/sample/yoru-no-eki.json', import.meta.url)));
assert.deepEqual(validateLyrics(sample), []);
assert.ok(validateLyrics({ lines: [] }).length);
assert.ok(validateLyrics({ lines: [{ start: 2, end: 1, jp: 'a', en: '', words: [] }] })[0].includes('start < end'));
assert.ok(validateLyrics({ lines: [{ start: 1, end: 2, jp: 'a', en: '', words: [{ t: '夜' }] }] }).some((e) => e.includes('reading')));
console.log('ok');
