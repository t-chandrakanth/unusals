const fs = require('fs');
const lf = (f) => fs.readFileSync(f, 'utf8').split('\r\n').join('\n');
function patch(file, pairs) {
  let s = lf(file);
  for (const [from, to] of pairs) {
    if (!s.includes(from)) throw new Error(file + ' missing: ' + from.slice(0, 70));
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
patch('js/app.js', [
  ["        h('h1', null, 'DPWCS LOCO'),\n        !isInstalled() && h('button', { class: 'install', onclick: installApp }, 'Install app')),",
   "        h('h1', null, 'DPWCS LOCO'),\n        h('span', { class: 'top-links' },\n          h('a', { class: 'install', href: 'unusual/' }, 'Unusals app'),\n          !isInstalled() && h('button', { class: 'install', onclick: installApp }, 'Install app'))),"],
]);
fs.appendFileSync('styles.css', `
.top-links { display: flex; align-items: center; gap: 8px; }
a.install { text-decoration: none; }
`);
patch('README.md', [
  ["\n## Setting up the shared database (one time)", `
## Unusals app

\`unusual/\` is a second, installable app on the same site, at
\`https://t-chandrakanth.github.io/unusals/unusual/\` (also linked from the
header of DPWCS LOCO). It keeps unusual reports in three groups, each day by
day, plus an All tab:

- **Loco failures**: heading, location, train, loco, load, reason, DET.
- **C&W failures**: heading, location, train, loco, reason, wagon no, BPC no, DET.
- **Others**: all of those boxes.

Reports can be shared as an image or Excel sheet in the daily-sheet layout, or
copied as text. A Sr.DEE PDF, or an Excel / PDF report sheet (one report or a
whole month), can be attached to fill the form or add the reports.

It uses the same data layer and the same \`unusuals\` table as the Unusuals tab
of DPWCS LOCO (the \`type\` of a report says which group it is in), so the two
show the same reports once \`supabase/setup-unusuals.sql\` has been run.
Until then each device keeps its own reports.

## Setting up the shared database (one time)`],
]);
fs.writeFileSync('sw.js', lf('sw.js').replace('loco-tracker-v23', 'loco-tracker-v24'));
console.log('ok');
