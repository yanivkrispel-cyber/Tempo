import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useLocation } from "react-router";
import { useApi } from "../../api/ApiProvider";
import styles from "./public.module.css";
import { isSourceCode } from "./source";

/**
 * What a member's link says about her (SL-8, R-1): her first name, or null (no `?src=`, a studio's own link, a name
 * she keeps hidden, or a lookup that fails), and the pass she gets when the friend's first class is attended, on her
 * referral link only. Any of those missing leaves the page as it was.
 */
function useInvite(slug: string): { name: string | null; reward: string | null } {
  const api = useApi();
  const code = new URLSearchParams(useLocation().search).get("src");
  const valid = code !== null && isSourceCode(code);
  const link = useQuery({
    queryKey: ["public-studio", slug, "link", code],
    queryFn: () =>
      unwrap(api.GET("/api/v1/public/studios/{slug}/links/{code}", { params: { path: { slug, code: code! } } })),
    enabled: valid,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return {
    name: link.data?.inviterFirstName?.trim() || null,
    reward: link.data?.reward?.productName.trim() || null,
  };
}

export function useInviterFirstName(slug: string): string | null {
  return useInvite(slug).name;
}

/**
 * "<first name> מזמינה אותך": only her first name, as text; nothing else about her. Under it, on her referral link,
 * what she gets when the friend comes (M-17 grants it to her, not to the friend, so the line promises the friend
 * nothing); with her name hidden, the same line without it.
 */
export function InviteHeader({ slug }: { slug: string }) {
  const { name, reward } = useInvite(slug);
  if (!name && !reward) return null;
  return (
    <div className={styles.inviteBlock}>
      {name && (
        <p className={`tp-label ${styles.invite}`}>
          <bdi>{name}</bdi> מזמינה אותך
        </p>
      )}
      {reward && (
        <p className={`tp-muted ${styles.inviteReward}`}>
          כשתגיעי לשיעור הראשון, {name ? <bdi>{name}</bdi> : "מי שהזמינה אותך"} מקבלת <bdi>{reward}</bdi>
        </p>
      )}
    </div>
  );
}
