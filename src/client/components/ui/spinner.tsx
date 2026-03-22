import { cn } from "@/lib/utils";

interface SpinnerProps {
  className?: string;
}

export function Spinner({ className }: SpinnerProps) {
  return (
    <div
      role="status"
      className={cn(
        "animate-spin rounded-full border-2 border-current border-t-transparent h-5 w-5",
        className,
      )}
      aria-label="Loading"
    />
  );
}
