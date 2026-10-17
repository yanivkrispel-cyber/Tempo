/**
 * Makes `window.matchMedia` answer as a screen `width` CSS pixels wide (min-width and max-width queries), so a test can
 * render the phone or the tablet layout (D15); jsdom has no matchMedia, and the apps then take the computer layout.
 * Returns the function that puts the original back.
 */
export function screenWidth(width: number): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as MediaQueryList;
  }) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
