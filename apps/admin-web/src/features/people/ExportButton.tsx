import { useMutation } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useLocation } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import { useAuth } from "../../auth/AuthProvider";
import { Button, useToast } from "../../shared/design-system";
import { todayIso } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";

/**
 * Everything the studio holds about one person, as a JSON file (docs/27 section 4.7): for a person who asks for
 * their data. Needs a recent sign-in (step-up); the API answers 401 auth.step_up_required otherwise.
 */
export function ExportButton({ personId, name }: { personId: string; name: string }) {
  const api = useApi();
  const toast = useToast();
  const { client } = useAuth();
  const { pathname } = useLocation();
  const { organizationId } = useStudio();
  const exportData = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/organizations/{organizationId}/people/{personId}/export", { params: { path: { organizationId, personId } } })),
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `tempo-${name.replace(/[^\p{L}\p{N}]+/gu, "-")}-${todayIso()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.show({ tone: "success", icon: "check", message: "הקובץ ירד. שמרו אותו במקום מאובטח." });
    },
    onError: (error) =>
      hasCode(error, "auth.step_up_required")
        ? toast.show({
            tone: "neutral",
            icon: "info",
            message: errorMessage(error),
            action: { label: "התחברות מחדש", onClick: () => void client?.signIn(pathname, "reauthenticate") }
          })
        : toast.show({ tone: "danger", icon: "info", message: errorMessage(error, "לא הצלחנו לייצא. נסו שוב.") })
  });

  return (
    <Button variant="secondary" size="sm" loading={exportData.isPending} onClick={() => exportData.mutate()}>
      ייצוא הנתונים
    </Button>
  );
}
