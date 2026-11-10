export interface DependencyCheck {
  readonly name: string;
  check(signal: AbortSignal): Promise<void>;
}
