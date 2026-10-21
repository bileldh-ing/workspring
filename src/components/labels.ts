import { formatMoney } from "@/domain/money";

export const DURATION_LABELS: Record<string, string> = {
  less_than_1_week: "Less than 1 week",
  "1_to_4_weeks": "1 to 4 weeks",
  "1_to_3_months": "1 to 3 months",
  "3_plus_months": "More than 3 months",
};
export const LEVEL_LABELS: Record<string, string> = { entry: "Entry level", intermediate: "Intermediate", expert: "Expert" };
export const SCOPE_LABELS: Record<string, string> = { small: "Small (a few weeks or less)", medium: "Medium (multi-month)", large: "Large (ongoing / 1 year+)" };
export const AVAILABILITY_LABELS: Record<string, string> = { available: "Available now", limited: "Limited availability", unavailable: "Not taking work" };

export function budgetText(j: { contract_type: string; budget_min_minor: number | null; budget_max_minor: number | null; currency: string }) {
  const max = j.budget_max_minor !== null ? formatMoney(j.budget_max_minor, j.currency) : null;
  const min = j.budget_min_minor !== null ? formatMoney(j.budget_min_minor, j.currency) : null;
  const range = min && max ? `${min}–${max}` : (max ?? "Budget not set");
  return j.contract_type === "hourly" ? `Hourly · ${range}/hr` : `Fixed price · ${range}`;
}
