/**
 * MessageControl shared style constants.
 * Centralizes the duplicated actionButtonClass that was previously
 * defined independently in every sub-component.
 *
 * Note: includes inline-flex + centering so it works with any element
 * (<Button>, <a>, <div>) — not just <Button> which has them built-in.
 */

export function getActionButtonClass(compact: boolean): string {
  return compact
    ? "inline-flex size-5 items-center justify-center rounded-none p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
    : "inline-flex size-5.5 items-center justify-center rounded-none p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
}
