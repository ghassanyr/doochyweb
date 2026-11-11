import type { AnchorHTMLAttributes, MouseEvent } from "react";

import { pathForView, type ViewKey } from "../routing";

/** Anchor that keeps canonical paths while switching views without a reload. */
export function RouteLink({
  view,
  onNavigate,
  onClick,
  children,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> & {
  view: ViewKey;
  onNavigate: (view: ViewKey) => void;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onNavigate(view);
  }

  return (
    <a {...props} href={pathForView(view)} onClick={handleClick}>
      {children}
    </a>
  );
}
