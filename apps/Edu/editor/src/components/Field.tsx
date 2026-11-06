import {useEffect, useRef, useState} from 'react';

export function Field({label, value, onCommit, multiline = false, maxLength, enforceMaxLength = false, disabled = false, placeholder = '', rows = 3}: {
  label?: string; value: string; onCommit: (value: string) => void; multiline?: boolean; maxLength?: number; enforceMaxLength?: boolean; disabled?: boolean; placeholder?: string; rows?: number;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const changed = useRef(false);
  const external = useRef(value);
  useEffect(() => {
    if (!focused.current || external.current !== value) {setDraft(value); changed.current = false;}
    external.current = value;
  }, [value]);
  const commit = () => {
    focused.current = false;
    if (changed.current && draft !== value) onCommit(draft);
    changed.current = false;
  };
  const common = {
    value: draft, disabled, placeholder, maxLength: enforceMaxLength ? maxLength : undefined, 'aria-label': label || placeholder,
    onFocus: () => {focused.current = true;},
    onChange: (event: React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>) => {setDraft(event.target.value); changed.current = true;},
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {setDraft(value); changed.current = false; (event.target as HTMLElement).blur();}
      if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) (event.target as HTMLElement).blur();
    },
  };
  return <label className="field">
    {label && <span className="field-label">{label}</span>}
    {multiline ? <textarea {...common} rows={rows} /> : <input {...common} />}
    {maxLength && <span className={`field-count ${Array.from(draft).length > maxLength ? 'over-limit' : ''}`}>{Array.from(draft).length}/{maxLength}</span>}
  </label>;
}
