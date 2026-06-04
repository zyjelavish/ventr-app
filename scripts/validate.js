// VENTR — Pre-push validatie
// Gebruik: node scripts/validate.js
// Controleert index.html op JS syntax fouten voor pushen

const fs = require('fs');
const { execSync } = require('child_process');

const html = fs.readFileSync('index.html', 'utf8');

// Extraheer <script> inhoud
const match = html.match(/<script>([\s\S]*?)<\/script>/g);
if (!match) { console.error('❌ Geen <script> tag gevonden'); process.exit(1); }

const js = match.map(s => s.replace(/<\/?script>/g, '')).join('\n');
const tmpFile = 'scripts/.tmp_validate.js';
fs.writeFileSync(tmpFile, js);

try {
  execSync(`node --check ${tmpFile}`, { stdio: 'pipe' });
  console.log('✅ JavaScript syntax OK');
} catch (err) {
  const msg = err.stderr?.toString() || err.message;
  console.error('❌ Syntax fout gevonden:\n' + msg.replace(tmpFile, 'index.html'));
  fs.unlinkSync(tmpFile);
  process.exit(1);
} finally {
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
}

// Extra checks
const orphanChecks = [
  { pattern: /\}\s*\n\s*\}\s*\n\s*\}\s*\n\s*\}\s*`;\s*\n\s*\}/m, label: 'orphaned template close' },
];

let warned = false;
orphanChecks.forEach(({ pattern, label }) => {
  if (pattern.test(js)) {
    console.warn(`⚠️  Mogelijk probleem: ${label}`);
    warned = true;
  }
});

if (!warned) console.log('✅ Extra checks OK');
console.log('\n✅ Klaar om te pushen.');
