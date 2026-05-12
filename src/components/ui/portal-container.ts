export function getTopDialogPortalContainer(): HTMLElement | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  const dialogContents = document.querySelectorAll<HTMLElement>("[data-dialog-content]");
  if (!dialogContents.length) {
    return undefined;
  }

  return dialogContents[dialogContents.length - 1];
}

