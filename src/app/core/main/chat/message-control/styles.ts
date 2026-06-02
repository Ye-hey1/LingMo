/**
 * MessageControl shared style constants.
 * Centralizes the duplicated actionButtonClass that was previously
 * defined independently in every sub-component.
 */

export function getActionButtonClass(compact: boolean): string {
  return compact
    ? "size-6 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
    : "size-6.5 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
}
