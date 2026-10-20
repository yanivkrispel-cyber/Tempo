import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useLocation } from "react-router";
import { useApi } from "../../api/ApiProvider";
import styles from "./public.module.css";
import { isSourceCode } from "./source";

/**
 * The first name of the member who sent this link (SL-8, board ה), or null: no `?src=`, a studio's own link, a name
 * she keeps hidden, or a lookup that fails. Any of those leaves the page as it was.
 */
export function useInviterFirstName(slug: string): string | null {
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
  const name = link.data?.inviterFirstName?.trim();
  return name ? name : null;
}

/** "<first name> מזמינה אותך": only her first name, as text; nothing else about her. */
export function InviteHeader({ slug }: { slug: string }) {
  const name = useInviterFirstName(slug);
  if (!name) return null;
  return (
    <p className={`tp-label ${styles.invite}`}>
      <bdi>{name}</bdi> מזמינה אותך
    </p>
  );
}
