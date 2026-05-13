const fs = require('fs');

const checks = [
  {
    file: 'popup.js',
    markers: [
      /\bSTATUS_APPROVED\b/,
      /\bSTATUS_AWAITING\b/,
      /\bSTATUS_SCREENED\b/,
      /\bSTATUS_PENDING_DUMMY\b/,
      /\bfunction\s+formatGbp\s*\(/,
      /\bfunction\s+formatEur\s*\(/
    ]
  },
  {
    file: 'background.js',
    markers: [
      /\bALARM_KEEPALIVE\b/,
      /\btryRefreshTokenFromTabBool\b/
    ]
  }
];

let failed = false;

for (const { file, markers } of checks) {
  const text = fs.readFileSync(file, 'utf8');
  for (const marker of markers) {
    if (marker.test(text)) {
      console.error(`${file}: dead-code marker still present: ${marker}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log('Dead-code cleanup markers are absent.');
