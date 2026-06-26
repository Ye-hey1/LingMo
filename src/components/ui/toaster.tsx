"use client"

import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

const CENTER_TOAST_DURATION_MS = 3000

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider duration={CENTER_TOAST_DURATION_MS}>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props} duration={CENTER_TOAST_DURATION_MS}>
            <div className="grid min-w-0 flex-1 justify-items-center gap-1 text-center">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
