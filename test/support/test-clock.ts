import type { Clock } from "../../src/application/ports/clock";

export class TestClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date("2026-11-10T12:00:00.000Z")) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
