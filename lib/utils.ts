import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Standard shadcn `cn` helper — merges class names with clsx + tailwind-merge
 * so later utility classes override earlier ones with the same property.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
