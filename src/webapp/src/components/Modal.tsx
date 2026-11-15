import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Button } from "./ui";

// Modal motion per the design system: 250ms fade + 12px rise on the card, a
// plain dim over the backdrop, and the reserved overlay shadow. Reduced motion
// is handled globally by the CSS rule in index.css plus framer's own easing.

export function AnimatedModal({
  open,
  onClose,
  title,
  subtitle,
  size = "sm",
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  // "sm" is the default compact sheet; "lg" is for dense content such as the
  // Analysis detail tables, which do not fit the narrow column.
  size?: "sm" | "lg";
  // Controls rendered in the header, between the title and the close button.
  actions?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={
              "relative max-h-[88vh] w-full overflow-y-auto rounded-3xl border border-hairline-strong bg-gradient-to-b from-surface-hover to-surface p-6 shadow-overlay " +
              (size === "lg" ? "max-w-3xl" : "max-w-md")
            }
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold tracking-tight">{title}</div>
                {subtitle && <div className="mt-0.5 text-xs text-fg-faint">{subtitle}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {actions}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded-md p-1 text-fg-muted transition hover:bg-surface-hover hover:text-fg"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  danger = false,
}: {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-sm rounded-3xl border border-hairline-strong bg-gradient-to-b from-surface-hover to-surface p-6 shadow-overlay"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="text-lg font-semibold tracking-tight">{title}</div>
            <div className="mt-2 text-sm text-fg-muted">{body}</div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant={danger ? "danger" : "primary"}
                onClickAsync={async () => {
                  // Keep the modal open if the action failed (the caller shows
                  // the error inside the body); only auto-close on success and
                  // never let a rejection leak into an unhandled rejection.
                  try {
                    await onConfirm();
                  } catch {
                    return;
                  }
                  onClose();
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}