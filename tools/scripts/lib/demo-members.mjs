/**
 * How `demo-studio.mjs clean` recognises a demo member without its manifest (#181): the invented name AND the
 * reserved `demo-member-NN@example.com` address seed gave it. A real person who happens to share a demo name is
 * never erased, because erasing cannot be undone.
 */
export const demoMemberEmail = (index) => `demo-member-${String(index + 1).padStart(2, "0")}@example.com`;

/** @param {{ displayName?: string, primaryEmail?: string | null }} person @param {{ displayName: string }[]} members */
export function isDemoMember(person, members) {
  const index = members.findIndex((m) => m.displayName === person.displayName);
  return index >= 0 && person.primaryEmail?.toLowerCase() === demoMemberEmail(index);
}
