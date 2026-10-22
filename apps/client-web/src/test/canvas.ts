/** A 2D context that records the text drawn and accepts every other call. */
export function recordingContext(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "fillText") return (text: string) => void texts.push(text);
      if (key === "measureText") return (text: string) => ({ width: text.length * 20 });
      if (key === "createLinearGradient") return () => gradient;
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}
