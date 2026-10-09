import { useEffect, useState } from 'react';

interface Props {
  value: number | null;
  min: number;
  max: number;
  placeholder?: string;
  /** Called with a valid number, or null when the field is optional and cleared. */
  onCommit: (v: number | null) => void;
  optional?: boolean;
  label: string;
}

/**
 * Number field that keeps the user's partial text while typing (e.g. "1" on the way to "100")
 * and only commits values inside [min, max]; out-of-range text snaps back on blur.
 */
export function MeasureInput({ value, min, max, placeholder, onCommit, optional, label }: Props) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);

  const parse = (text: string) => {
    const n = Number(text);
    return text.trim() !== '' && Number.isFinite(n) && n >= min && n <= max ? n : null;
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      placeholder={placeholder}
      aria-label={label}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parse(e.target.value);
        if (n !== null) onCommit(n);
        else if (optional && e.target.value.trim() === '') onCommit(null);
      }}
      onBlur={() => {
        if (parse(draft) === null && !(optional && draft.trim() === '')) {
          setDraft(value == null ? '' : String(value));
        }
      }}
    />
  );
}
