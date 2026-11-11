// The look of the headings: each one at the left with a small round symbol in front, as a button would
// have. The headings are made by the app's own screens, so this adds the symbols afterwards, to whatever
// is on the page, and again when the page changes.

const ICONS = [
  // [words in the heading, symbol]
  ['train details', '\u{1F686}'], ['train and stalling details', '\u{1F4CC}'], ['train and wagon', '\u{1F686}'], ['location', '\u{1F4CD}'],
  ['train no', '\u{1F516}'], ['loco no', '\u{1F682}'], ['load table', '\u{1F4CA}'], ['gradient chart', '\u{1F4C8}'], ['load', '⚖️'],
  ['wagon', '\u{1F6DE}'], ['bpc', '\u{1F3F7}️'], ['det from', '⏱️'], ['det to', '⏱️'], ['det', '⌛'],
  ['sequence of events', '\u{1F552}'], ['chronology', '\u{1F552}'], ['plan of action', '\u{1F4DD}'], ['repercussion', '⚠️'],
  ['date of incident', '\u{1F4C5}'], ['time of incident', '⏰'], ['date', '\u{1F4C5}'], ['previous station', '\u{1F3C1}'],
  ['stalled at', '\u{1F4CD}'], ['section', '\u{1F6E4}️'], ['gradient', '\u{1F4C8}'], ['speed', '\u{1F680}'], ['signal', '\u{1F6A6}'],
  ['weather', '\u{1F326}️'], ['caution', '⚠️'], ['cause', '❗'], ['remarks', '\u{1F4AC}'], ['photo', '\u{1F4F7}'],
  ['block', '\u{1F6A7}'], ['station', '\u{1F689}'], ['from', '▶️'], ['cleared', '✅'], ['as on', '\u{1F552}'],
  ['report', '\u{1F4DD}'], ['heading', '\u{1F524}'], ['note', '\u{1F5D2}️'],
];
const TABS = [['loco', '\u{1F682}'], ['stalling', '\u{1F6D1}'], ['c&w', '\u{1F527}'], ['all', '\u{1F4CB}'], ['block', '\u{1F6A7}'], ['other', '\u{1F4C4}']];

const iconFor = (text, list) => { const t = text.toLowerCase(); const hit = list.find(([w]) => t.includes(w)); return hit ? hit[1] : ''; };
const BIG = '.ncell.events > span, .field.wide > span, h3.rep-title, .section-title, .newhead h2';

function decorate() {
  // the section headings are the big ones; the captions of the boxes are the small ones
  document.querySelectorAll('.ncell > span, .field > span, h3.rep-title, .newhead h2, .ucard-reason, .tabs button').forEach((el) => {
    if (el.dataset.ico) return;
    const isTab = el.matches('.tabs button');
    const text = (el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild.textContent : el.textContent).trim();
    const icon = isTab ? iconFor(el.textContent, TABS) : iconFor(text, ICONS);
    el.dataset.ico = icon ? '1' : '0';
    if (!icon || el.matches('.ucard-reason')) return;
    const i = document.createElement('i');
    i.className = 'ico';
    i.setAttribute('aria-hidden', 'true');
    i.textContent = icon;
    if (isTab) { const dot = el.querySelector('.dot-k'); if (dot) dot.remove(); }
    el.prepend(i);
    if (!isTab) el.classList.add('hd');
    if (el.matches(BIG)) el.classList.add('hd-big');
  });
}

let queued = false;
const again = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; decorate(); }); };
new MutationObserver(again).observe(document.documentElement, { childList: true, subtree: true });
decorate();
