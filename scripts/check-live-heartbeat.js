const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

const content = read('content.js');
const background = read('background.js');
const popup = read('popup.js');
const manifest = JSON.parse(read('manifest.json'));

if (manifest.version !== '1.5.3') {
  fail(`manifest.json version is ${manifest.version}, expected 1.5.3`);
}

if (!/let\s+lastSentSignature\s*=\s*null\s*;/.test(content)) {
  fail('content.js must initialize lastSentSignature to null so the first empty live poll is sent');
}

if (!content.includes("type: 'LIVE_HEARTBEAT'")) {
  fail('content.js must send LIVE_HEARTBEAT for successful unchanged live polls');
}

const unchangedBlock = content.match(/if\s*\(\s*sig\s*===\s*lastSentSignature\s*\)\s*\{([\s\S]*?)\n\s*\}/);
if (!unchangedBlock || !unchangedBlock[1].includes("type: 'LIVE_HEARTBEAT'")) {
  fail('content.js unchanged-signature branch must send LIVE_HEARTBEAT before returning');
}

if (!/const\s+LIVE_FRESHNESS_WINDOW_MS\s*=\s*(\d+)\s*;/.test(background)) {
  fail('background.js must define LIVE_FRESHNESS_WINDOW_MS');
} else {
  const value = Number(background.match(/const\s+LIVE_FRESHNESS_WINDOW_MS\s*=\s*(\d+)\s*;/)[1]);
  if (value < 15000) {
    fail(`background.js LIVE_FRESHNESS_WINDOW_MS is ${value}, expected at least 15000`);
  }
}

if (!/const\s+LIVE_FRESHNESS_WINDOW_MS\s*=\s*(\d+)\s*;/.test(popup)) {
  fail('popup.js must define LIVE_FRESHNESS_WINDOW_MS');
} else {
  const value = Number(popup.match(/const\s+LIVE_FRESHNESS_WINDOW_MS\s*=\s*(\d+)\s*;/)[1]);
  if (value < 15000) {
    fail(`popup.js LIVE_FRESHNESS_WINDOW_MS is ${value}, expected at least 15000`);
  }
}

if (/ageMs\s*<\s*10000/.test(background) || /ageMs\s*<\s*10000/.test(popup)) {
  fail('live freshness checks must use LIVE_FRESHNESS_WINDOW_MS instead of the old 10000ms literal');
}

const heartbeatCase = background.match(/case\s+'LIVE_HEARTBEAT':([\s\S]*?)case\s+'/);
if (!heartbeatCase) {
  fail('background.js must handle LIVE_HEARTBEAT messages');
} else {
  const block = heartbeatCase[1];
  if (!block.includes('lastLiveUpdate')) {
    fail('LIVE_HEARTBEAT handler must refresh lastLiveUpdate');
  }
  if (block.includes('processStudies(')) {
    fail('LIVE_HEARTBEAT handler must not reprocess studies');
  }
}

if (!process.exitCode) {
  console.log('Live heartbeat regression check passed.');
}
