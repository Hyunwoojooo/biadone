import {useEffect, useId, useRef} from 'react';
import {X} from 'lucide-react';

export function Dialog({title, children, onClose, wide = false}: {title: string; children: React.ReactNode; onClose: () => void; wide?: boolean}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current; dialog?.showModal();
    const cancel = (event: Event) => {event.preventDefault(); closeRef.current();};
    dialog?.addEventListener('cancel', cancel);
    return () => {dialog?.removeEventListener('cancel', cancel); dialog?.close(); if (opener?.isConnected) opener.focus({preventScroll: true});};
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={`dialog ${wide ? 'wide' : ''}`} onClick={event => {if (event.target === event.currentTarget) onClose();}}>
    <header className="dialog-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={18}/></button></header>
    {children}
  </dialog>;
}
