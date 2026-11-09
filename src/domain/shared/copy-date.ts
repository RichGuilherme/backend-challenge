export function copyDate(date: Date): Date;
export function copyDate(date: Date | undefined): Date | undefined;
export function copyDate(date: Date | undefined): Date | undefined {
  return date === undefined ? undefined : new Date(date.getTime());
}
