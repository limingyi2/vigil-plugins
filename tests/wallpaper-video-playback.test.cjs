const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'wallpaper', 'frontend.js'), 'utf8');
const start = source.indexOf('// VIDEO_PLAYBACK_HELPER_START');
const end = source.indexOf('// VIDEO_PLAYBACK_HELPER_END', start);
assert.notEqual(start, -1, 'video playback helper marker exists');
assert.notEqual(end, -1, 'video playback helper end marker exists');
const helperSource = source.slice(start, end).replace('// VIDEO_PLAYBACK_HELPER_START', '');
const startVideoPlayback = new Function(`${helperSource}; return startVideoPlayback;`)();

class FakeVideo {
  constructor(play) {
    this.paused = true;
    this.readyState = 0;
    this.muted = false;
    this.error = null;
    this.listeners = new Map();
    this.playImpl = play;
  }
  addEventListener(name, callback) {
    const callbacks = this.listeners.get(name) || new Set();
    callbacks.add(callback);
    this.listeners.set(name, callbacks);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name) { for (const callback of this.listeners.get(name) || []) callback(); }
  play() { return this.playImpl.call(this); }
}

test('waits for the video playing event before reporting success', async () => {
  const video = new FakeVideo(function () {
    this.paused = false;
    this.readyState = 2;
    queueMicrotask(() => this.emit('playing'));
    return Promise.resolve();
  });
  const result = await startVideoPlayback(video, 100);
  assert.equal(result.ok, true);
  assert.equal(result.mutedFallback, false);
});

test('retries with muted audio when Chromium rejects autoplay', async () => {
  let attempts = 0;
  const video = new FakeVideo(function () {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    this.readyState = 2;
    queueMicrotask(() => this.emit('playing'));
    return Promise.resolve();
  });
  const result = await startVideoPlayback(video, 100);
  assert.equal(result.ok, true);
  assert.equal(result.mutedFallback, true);
  assert.equal(video.muted, true);
  assert.equal(attempts, 2);
});

test('reports decoder or file errors instead of silently accepting black output', async () => {
  const video = new FakeVideo(function () {
    queueMicrotask(() => {
      this.error = { code: 3 };
      this.emit('error');
    });
    return Promise.resolve();
  });
  const result = await startVideoPlayback(video, 100);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 3);
});

test('video selection preserves the previous wallpaper until playback succeeds', () => {
  const selectStart = source.indexOf('  function select(item) {');
  const selectEnd = source.indexOf('  function localFile(file) {', selectStart);
  const selectSource = source.slice(selectStart, selectEnd);
  assert.match(selectSource, /if \(item\.type !== 'video'\)\s*\{\s*active = item;/);
  assert.match(selectSource, /const previousActive = active;/);
  assert.match(selectSource, /mount\(item\)\.then\(\(ok\) => \{/);
});

test('pauses and resumes the actual video element as the window visibility changes', () => {
  const visibilityStart = source.indexOf('  function onVisibility() {');
  const visibilityEnd = source.indexOf('  function dispose() {', visibilityStart);
  const visibilitySource = source.slice(visibilityStart, visibilityEnd);
  assert.match(visibilitySource, /if \(videoNode\).*videoNode\.pause\(\)/s);
  assert.match(visibilitySource, /startVideoPlayback\(videoNode\)/);
});
