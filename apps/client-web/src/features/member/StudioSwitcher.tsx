import { activeMemberships, useAccount } from "../../account/account";
import { useStudioPath } from "../../app/studioPath";
import { DropdownMenu, Icon } from "../../shared/design-system";
import type { Studio } from "./studio";
import { chooseStudio } from "./studioChoice";
import styles from "./member.module.css";

/**
 * The generic app's studio switcher, for a member of two or more studios (docs/35 W-5): the studio's name opens the
 * list of studios, and the choice stays on this device. A studio's own app (`/s/<slug>/`) is locked to its studio
 * and shows the name only, as does a member of one studio.
 */
export function StudioSwitcher({ studio }: { studio: Studio }) {
  const memberships = useSwitchableStudios();
  if (!memberships) return null;
  return (
    <DropdownMenu
      label={studio.name}
      variant="ghost"
      size="sm"
      className={styles.switcher}
      items={memberships.map(({ organization }) => ({
        label: organization.displayName,
        icon: organization.id === studio.id ? "check" : undefined,
        onSelect: () => chooseStudio(organization.id),
      }))}
    >
      <span className="tp-sr-only">, החלפת סטודיו</span>
      <Icon name="chevron-down" />
    </DropdownMenu>
  );
}

/** The member's studios when the switcher shows; null when it does not. */
export function useSwitchableStudios() {
  const memberships = activeMemberships(useAccount());
  const path = useStudioPath();
  return path || memberships.length < 2 ? null : memberships;
}
