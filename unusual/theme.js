// The look of the headings: each one at the left, in capitals, bold. The headings are made by the app's own
// screens, so the styles are put on them afterwards, on whatever is on the page, and again when the page
// changes. (No symbols: the headings are words only.)

const BIG = '.ncell.events > span, .field.wide > span, h3.rep-title, .section-title, .newhead h2';

function decorate() {
  // the section headings are the big ones; the captions of the boxes are the small ones
  document.querySelectorAll('.ncell > span, .field > span, h3.rep-title, .newhead h2').forEach((el) => {
    if (el.dataset.hd) return;
    el.dataset.hd = '1';
    el.classList.add('hd');
    if (el.matches(BIG)) el.classList.add('hd-big');
  });
}

let queued = false;
const again = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; decorate(); }); };
new MutationObserver(again).observe(document.documentElement, { childList: true, subtree: true });
decorate();
