// Keeps keyboard focus inside an open dialog (QA 16 Nov: Shift+Tab from Close left the job dialog). On open focus moves into the dialog;
// Tab on the last control wraps to the first and Shift+Tab on the first wraps to the last; Escape closes; on close focus returns to the opener.
import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], details > summary, button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Inside a closed <details> only its own summary can take focus (Chrome still gives the hidden content a layout box, so offsetParent is not enough).
const hiddenInDetails = (el: HTMLElement): boolean => {
  for (let d = el.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) {
    if (!(d as HTMLDetailsElement).open && !(el.tagName === 'SUMMARY' && el.parentElement === d)) return true;
  }
  return false;
};

// Open dialogs, newest last: only the top one handles keys ("Did you apply?" can open over the job dialog).
const open: object[] = [];

export function useDialogFocus<T extends HTMLElement>(onClose: () => void, focusFirst = false) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const me = {};
    open.push(me);
    // read the element at each key press: the dialog's box can be re-created while it is open (the job's details arrive)
    const items = (box: HTMLElement | null) => (box ? Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el === document.activeElement || (el.offsetParent !== null && !hiddenInDetails(el))) : []);
    if (focusFirst) (items(ref.current)[0] || ref.current)?.focus(); else ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (open[open.length - 1] !== me) return;
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
      const box = ref.current;
      if (e.key !== 'Tab' || !box) return;
      const list = items(box);
      if (!list.length) { e.preventDefault(); box.focus(); return; }
      const first = list[0], last = list[list.length - 1], at = document.activeElement as HTMLElement | null;
      const inside = !!at && box.contains(at);
      if (e.shiftKey && (!inside || at === first || at === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || at === last)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); open.splice(open.indexOf(me), 1); previous?.focus?.(); };
  }, [focusFirst]);
  return ref;
}
