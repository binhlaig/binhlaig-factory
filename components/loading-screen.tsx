export type LoadingScreenProps = {
  variant?: "page" | "section" | "inline";
  title?: string;
  description?: string;
  className?: string;
};

export function LoadingScreen({
  variant = "page",
  title = "Loading…",
  description,
  className = "",
}: LoadingScreenProps) {
  const inline = variant === "inline";
  const layout = {
    page: "flex min-h-dvh w-full items-center justify-center bg-white px-6 py-10 dark:bg-slate-950",
    section: "flex min-h-40 w-full items-center justify-center px-4 py-8",
    inline: "inline-flex max-w-full align-middle",
  }[variant];

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`${layout} text-slate-900 dark:text-slate-100 ${className}`}
    >
      <span
        className={
          inline
            ? "inline-flex min-w-0 items-center gap-2"
            : "flex w-full max-w-sm flex-col items-center gap-4 text-center"
        }
      >
        <span
          aria-hidden="true"
          className={`relative inline-grid shrink-0 place-items-center ${inline ? "size-5" : "size-16"}`}
        >
          <span className="absolute inset-0 rounded-full border-2 border-blue-100 border-t-blue-600 motion-safe:animate-spin dark:border-blue-950 dark:border-t-blue-400" />
          {!inline && (
            <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-xl font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              B
            </span>
          )}
        </span>
        <span className={inline ? "min-w-0 text-xs leading-5" : "min-w-0 space-y-1"}>
          <span className={inline ? "font-medium" : "block text-sm font-semibold sm:text-base"}>
            {title}
          </span>
          {description && (
            <span className={`${inline ? "ml-2" : "block"} text-xs leading-5 text-slate-600 dark:text-slate-400`}>
              {description}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}