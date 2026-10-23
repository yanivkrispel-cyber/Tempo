import { useQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import type { ChipTone } from "../../shared/design-system";
import { useStudio } from "../console/studio";
import { categoryLabel } from "../../shared/studio/classTypes";

export type PassProduct = Schemas["PassProduct"];
export type PassKind = Schemas["PassKind"];
export type Pass = Schemas["Pass"];

/** Keys start with the studio, as everywhere in the console; a person's passes sit under the person's key. */
export const passKeys = {
  products: (organizationId: string) => ["studio", organizationId, "pass-products"] as const,
  person: (organizationId: string, personId: string) =>
    ["studio", organizationId, "person", personId, "passes"] as const,
};

export function usePassProducts() {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: passKeys.products(organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/pass-products", { params: { path: { organizationId } } }),
      ).then((list) => list.items),
  });
}

export function usePersonPasses(personId: string) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: passKeys.person(organizationId, personId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/people/{personId}/passes", {
          params: { path: { organizationId, personId } },
        }),
      ).then((list) => list.items),
  });
}

export const kindLabels: Record<PassKind, string> = { punch_card: "כרטיסייה", membership: "מנוי" };

/** "10 כניסות", "ללא הגבלה", "עד 2 שיעורים בשבוע". */
export function allowance(
  kind: PassKind,
  entries: number | null | undefined,
  weeklyCap: number | null | undefined,
): string {
  if (kind === "punch_card") return entries === 1 ? "כניסה אחת" : `${entries ?? 0} כניסות`;
  if (weeklyCap == null) return "ללא הגבלה";
  return weeklyCap === 1 ? "שיעור אחד בשבוע" : `עד ${weeklyCap} שיעורים בשבוע`;
}

export function daysLabel(days: number): string {
  return days === 1 ? "יום אחד" : `${days} ימים`;
}

/** "כל השיעורים" or the one category a product is limited to. */
export function categoryScope(category: string | null | undefined): string {
  return category ? `רק ${categoryLabel(category)}` : "כל השיעורים";
}

const shekels = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });
const wholeShekels = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });

/** "600 ₪" or "49.90 ₪": agorot only when there are some, as the member app shows prices (publicText.priceText). */
export function priceLabel(agorot: number | null | undefined): string {
  if (agorot == null) return "—";
  return (agorot % 100 === 0 ? wholeShekels : shekels).format(agorot / 100);
}

/** Shekels as typed ("450", "99.90") to agorot, or null. */
export function toAgorot(text: string): number | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export const passStatus: Record<Pass["status"], { text: string; tone: ChipTone }> = {
  active: { text: "בתוקף", tone: "success" },
  expired: { text: "פג תוקף", tone: "neutral" },
  voided: { text: "בוטל", tone: "danger" },
};
