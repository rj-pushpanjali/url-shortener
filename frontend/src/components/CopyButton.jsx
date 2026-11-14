// src/components/CopyButton.jsx
//
// Copies text to the clipboard and briefly shows "Copied!".
// navigator.clipboard needs a secure context; http://localhost counts as
// one, so this works in development.

import { useEffect, useRef, useState } from 'react';

export default function CopyButton({ text }) {
  const [status, setStatus] = useState('idle'); // idle | copied | failed
  const timer = useRef(null);

  // Don't update state after the component is gone.
  useEffect(() => () => clearTimeout(timer.current), []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), 1500);
  }

  const label = status === 'copied' ? 'Copied!' : status === 'failed' ? 'Copy failed' : 'Copy';

  return (
    <button type="button" className="secondary" onClick={handleCopy}>
      {label}
    </button>
  );
}
