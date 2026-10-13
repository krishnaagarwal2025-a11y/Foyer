/** Let an embedded player build a buffer before another automatic drift seek.
 * Explicit host seeks remain immediate; this only gates local corrections. */
export class ProviderRecovery {
  private wasBuffering = false;
  private quietUntil = 0;
  private seekUntil = 0;
  constructor(private now = () => performance.now()) {}
  observeBuffering(buffering: boolean) {
    if (this.wasBuffering && !buffering) this.quietUntil = this.now() + 1000;
    this.wasBuffering = buffering;
  }
  sought() {
    this.seekUntil = this.now() + 4000;
  }
  get correctionReady() {
    return (
      !this.wasBuffering &&
      this.now() >= Math.max(this.quietUntil, this.seekUntil)
    );
  }
}
