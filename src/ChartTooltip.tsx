import { createPortal } from "react-dom";

export type TooltipData = { id: string; text: string; anchor: DOMRect; container?: Element };

/** Modal tooltips belong inside the dialog's top layer; others use the document. */
export function ChartTooltip({ value }: { value: TooltipData }) {
  const width = Math.min(280, window.innerWidth - 32);
  const left = Math.max(
    16,
    Math.min((value.anchor.left + value.anchor.right - width) / 2, window.innerWidth - width - 16),
  );
  const below = value.anchor.top < 120;
  return createPortal(
    <div
      role="tooltip"
      id="chart-tooltip"
      className="chart-tooltip"
      style={{
        width,
        left,
        top: below ? value.anchor.bottom : value.anchor.top,
        transform: below ? undefined : "translateY(-100%)",
      }}
    >
      {value.text
        .split("\n")
        .map((line, index) =>
          index === 0 ? <strong key={index}>{line}</strong> : <span key={index}>{line}</span>,
        )}
    </div>,
    value.container ?? document.body,
  );
}
