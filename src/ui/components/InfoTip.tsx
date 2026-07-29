import { useId } from "react";
import { Info } from "lucide-react";

type Props = {
  /** Plain-language explanation of what the surrounding box means. */
  text: string;
  /** Which side of the trigger the bubble grows toward. */
  align?: "left" | "right";
};

export function InfoTip({ text, align = "right" }: Props) {
  const id = useId();
  return (
    <span className="relative inline-flex group align-middle">
      <button
        type="button"
        aria-label="What is this?"
        aria-describedby={id}
        className="focus-ring inline-flex items-center justify-center w-4 h-4 rounded-full text-muted hover:text-text transition-colors duration-150 cursor-help"
      >
        <Info size={13} strokeWidth={2} aria-hidden="true" />
      </button>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute top-full mt-2 z-50 w-60 rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text normal-case tracking-normal opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        {text}
      </span>
    </span>
  );
}

/** Uppercase section label with an info affordance next to it. */
export function SectionLabel({
  children,
  info,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  info: string;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <div className={`metric-label flex items-center gap-1.5 ${className}`}>
      <span>{children}</span>
      <InfoTip text={info} align={align} />
    </div>
  );
}
