import { describe, expect, it } from "vitest";
import { ProviderRecovery } from "../src/player/ProviderRecovery";

describe("embedded provider buffer recovery", () => {
  it("allows initial corrections but gives recovered buffering a stable second", () => {
    let now = 0;
    const recovery = new ProviderRecovery(() => now);
    expect(recovery.correctionReady).toBe(true);
    recovery.observeBuffering(true);
    now = 10000;
    expect(recovery.correctionReady).toBe(false);
    recovery.observeBuffering(false);
    now = 10999;
    expect(recovery.correctionReady).toBe(false);
    now = 11000;
    recovery.observeBuffering(false);
    expect(recovery.correctionReady).toBe(true);
  });
  it("spaces automatic seeks without repeated ready polls extending the hold", () => {
    let now = 5000;
    const recovery = new ProviderRecovery(() => now);
    recovery.sought();
    for (now = 5100; now < 9000; now += 100) {
      recovery.observeBuffering(false);
      expect(recovery.correctionReady).toBe(false);
    }
    expect(recovery.correctionReady).toBe(true);
    recovery.observeBuffering(true);
    recovery.observeBuffering(false);
    expect(recovery.correctionReady).toBe(false);
  });
});
