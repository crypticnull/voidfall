// Rewrites main.js's run-scoped globals to live on the shared state object in state.js.
//
// This uses TypeScript's parser rather than regex on purpose. The identifiers involved
// ("state", "boss", "kills", "player") appear as property names, object shorthand, declaration
// names and inside comments and strings — a textual replace corrupts several of those, and it
// does so silently. Walking real AST nodes lets each occurrence be classified exactly.
//
// Usage:  node tools/codemod-state.js [--dry]
const fs = require('fs');
const path = require('path');
const ts = require(path.join(process.cwd(), 'node_modules', 'typescript'));

const FILE = path.join(process.cwd(), 'src', 'main.js');
const ALIAS = 'S';

// The run-scoped state: everything reset when a run starts. Deliberately NOT included are the
// input/gamepad/menu-chrome variables — those belong to main.js and no other module wants them.
const NAMES = new Set([
  'state', 'player', 'enemies', 'projectiles', 'effects', 'minions', 'pickups', 'dmgNumbers',
  'toasts', 'bloodDecals', 'decorObjects', 'elapsed', 'stageElapsed', 'kills', 'stageKills',
  'nextId', 'spawnTimer', 'bossSpawned', 'boss', 'pendingLevelUps', 'rerollsLeft',
  'beatFinalBoss', 'endlessWave', 'keyCount', 'unbankedGold', 'currentStage',
]);

const src = fs.readFileSync(FILE, 'utf8');
const sf = ts.createSourceFile('main.js', src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);

const edits = [];
let shorthandFixes = 0;

function skip(node) {
  const p = node.parent;
  if (!p) return true;
  // `foo.player` — the part after the dot is a property, not our variable.
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true;
  // `{ player: ... }` — the key is not our variable.
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  // Declarations, parameters, bindings, labels, imports: all define a name rather than read one.
  if (ts.isVariableDeclaration(p) && p.name === node) return true;
  if (ts.isParameter(p) && p.name === node) return true;
  if (ts.isBindingElement(p) && (p.name === node || p.propertyName === node)) return true;
  if (ts.isFunctionDeclaration(p) && p.name === node) return true;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return true;
  if (ts.isMethodDeclaration(p) && p.name === node) return true;
  return false;
}

function walk(node) {
  if (ts.isIdentifier(node) && NAMES.has(node.text)) {
    // `{ player }` shorthand must become `{ player: S.player }`, not `{ S.player }`.
    if (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node) {
      edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `${node.text}: ${ALIAS}.${node.text}` });
      shorthandFixes++;
    } else if (!skip(node)) {
      edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `${ALIAS}.${node.text}` });
    }
  }
  ts.forEachChild(node, walk);
}
walk(sf);

// Apply back-to-front so earlier offsets stay valid.
edits.sort((a, b) => b.start - a.start);
let out = src;
for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

const report = { edits: edits.length, shorthandFixes };
if (process.argv.includes('--dry')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  fs.writeFileSync(FILE, out, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}
