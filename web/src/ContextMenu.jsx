import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Menú contextual en la posición del clic. items: [{ label, onClick, danger }] */
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // que no se salga de la ventana
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <ul className="ctx" ref={ref} style={pos} onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}>
      {items.map((it) => (
        <li key={it.label} className={it.danger ? 'danger' : ''} onClick={() => { onClose(); it.onClick(); }}>{it.label}</li>
      ))}
    </ul>
  );
}
