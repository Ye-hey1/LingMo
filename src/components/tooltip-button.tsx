import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function TooltipButton(
  {
    icon,
    tooltipText, 
    onClick,
    disabled = false,
    variant = "ghost",
    size = "icon",
    side = "top",
    buttonClassName,
    buttonId,
    type = "button",
    ...props 
  }:
  {
    icon: React.ReactNode;
    tooltipText: string;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | null | undefined;
    size?: "icon" | "sm" | "default" | "lg";
    side?: "top" | "right" | "bottom" | "left";
    buttonClassName?: string;
    buttonId?: string;
    type?: "button" | "submit" | "reset";
  })
{
  return (
    <TooltipProvider>
      <Tooltip {...props}>
        <TooltipTrigger asChild>
          <Button id={buttonId} type={type} className={cn("relative", buttonClassName)} disabled={disabled} size={size} variant={variant} onClick={onClick} aria-label={tooltipText}>
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side}>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
