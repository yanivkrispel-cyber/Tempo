import { ButtonLink, EmptyState } from "../shared/design-system";

export function NotFoundPage() {
  return (
    <main className="tp-page tp-page--center">
      <EmptyState
        title="הדף לא נמצא"
        titleAs="h1"
        action={
          <ButtonLink to="/" variant="secondary">
            לדף הבית
          </ButtonLink>
        }
      />
    </main>
  );
}
