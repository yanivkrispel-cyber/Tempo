/** Previous and next keys follow the reading direction: in RTL, ArrowLeft moves forward. */
export function isRtl(element: Element): boolean {
  return element.closest("[dir]")?.getAttribute("dir") === "rtl";
}
