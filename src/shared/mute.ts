export class MuteManager {
  private muted = false;
  private muteUntil: number | null = null;

  isMuted(): boolean {
    if (this.muteUntil !== null) {
      if (Date.now() >= this.muteUntil) {
        this.muteUntil = null;
        this.muted = false;
        return false;
      }
      return true;
    }
    return this.muted;
  }

  muteAll(): void {
    this.muted = true;
    this.muteUntil = null;
  }

  muteFor(ms: number): void {
    this.muted = true;
    this.muteUntil = Date.now() + ms;
  }

  unmute(): void {
    this.muted = false;
    this.muteUntil = null;
  }

  status(): string {
    if (this.muteUntil !== null) {
      const remaining = Math.max(0, this.muteUntil - Date.now());
      if (remaining === 0) {
        this.unmute();
        return "unmuted";
      }
      return `muted (${Math.ceil(remaining / 1000)}s remaining)`;
    }
    return this.muted ? "muted (indefinite)" : "unmuted";
  }
}
