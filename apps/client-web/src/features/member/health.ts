// The member's own health declaration on the real API (docs/31, H-1 to H-9). The member's reads carry the status,
// the dates and the current form, never the answers or the names: what the member typed lives only in the form's
// state until it is sent, and is dropped when the form closes.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TempoApiError, unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import type { SignatureValue, YesNoAnswers } from "../../shared/design-system";

export type MyHealthDeclaration = Schemas["MyHealthDeclaration"];
export type HealthForm = Schemas["HealthForm"];
export type HealthDeclarationStatusView = Schemas["HealthDeclarationStatusView"];

export const healthKey = (organizationId: string) => ["studio", organizationId, "health-declaration"] as const;

const retryOnce = (failures: number, error: unknown) =>
  failures < 1 && !(error instanceof TempoApiError && error.status < 500);

/** My status in the studio, the current form, and whether the studio requires a signed declaration to book. */
export function useMyHealthDeclaration(organizationId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: healthKey(organizationId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/me/health-declaration", {
          params: { path: { organizationId: organizationId! } },
        }),
      ),
    enabled: Boolean(organizationId),
    retry: retryOnce,
  });
}

export interface SignInput {
  form: HealthForm;
  answers: YesNoAnswers;
  signature: SignatureValue;
}

/** The request body: every question of the form in its order, the names trimmed, the guardian's only for a guardian. */
export function signRequest({ form, answers, signature }: SignInput): Schemas["SignHealthDeclarationRequest"] {
  const guardian = signature.signerRole === "guardian";
  return {
    formVersion: form.version,
    answers: form.questions.map((question) => ({ questionId: question.id, answer: answers[question.id] === true })),
    signedName: signature.signedName.trim(),
    signerRole: signature.signerRole,
    guardianName: guardian ? signature.guardianName.trim() : null,
    confirmed: true,
  };
}

/**
 * Signs the current form. The answer is the new status, which replaces the cached one. A stale form version (the
 * platform published a new one meanwhile) reloads the form.
 */
export function useSignHealthDeclaration(organizationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SignInput) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/me/health-declaration", {
          params: { path: { organizationId } },
          body: signRequest(input),
        }),
      ),
    onSuccess: (declaration) => queryClient.setQueryData(healthKey(organizationId), declaration),
    onError: (error) => {
      if (error instanceof TempoApiError && error.code === "health.form_version_stale")
        void queryClient.invalidateQueries({ queryKey: healthKey(organizationId) });
    },
  });
}
