import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Scroll only the hidden portion of a long label, with a pause at each end. */
export function OverflowScrollText({ text, children, className }: {
  text: string;
  children?: ReactNode;
  className: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const measure = () => setOverflow(Math.max(0, Math.ceil(content.scrollWidth - viewport.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [text]);

  const style = {
    "--overflow-distance": `-${overflow}px`,
    "--scroll-duration": `${Math.max(14, Math.min(38, 10 + overflow / 16))}s`,
  } as CSSProperties;

  return (
    <div ref={viewportRef} className="min-w-0 overflow-hidden" title={text}>
      <div ref={contentRef} style={style} className={`${className} w-max max-w-none whitespace-nowrap ${overflow ? "ytm-overflow-scroll" : ""}`}>
        {children ?? text}
      </div>
    </div>
  );
}
