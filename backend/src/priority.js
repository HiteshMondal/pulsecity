// Rule-based priority engine. Single source of truth: used by the API and copied into both Lambdas.
// Override any rule at runtime with PRIORITY_RULES_JSON (partial JSON is merged).
export const DEFAULT_RULES = {
  severity: { fallen_tree: 5, road_hazard: 5, water_leak: 4, drain_blockage: 4, pothole: 3, streetlight: 2, garbage: 2, graffiti: 1 },
  weights: { severity: 12, perDayOpen: 3, ageCap: 24, photo: 4, keyword: 10 },
  keywords: ['danger', 'flood', 'accident', 'injur', 'electric', 'sparking', 'collapse', 'overflow', 'school'],
  thresholds: { urgent: 70, high: 50, medium: 30 },
  slaHours: { urgent: 24, high: 72, medium: 120, low: 240 },
};
const load = () => {
  try {
    if (!process.env.PRIORITY_RULES_JSON) {
      return DEFAULT_RULES;
    }

    const override = JSON.parse(process.env.PRIORITY_RULES_JSON);

    return {
      ...DEFAULT_RULES,
      ...override,

      severity: {
        ...DEFAULT_RULES.severity,
        ...override.severity
      },

      weights: {
        ...DEFAULT_RULES.weights,
        ...override.weights
      },

      thresholds: {
        ...DEFAULT_RULES.thresholds,
        ...override.thresholds
      },

      slaHours: {
        ...DEFAULT_RULES.slaHours,
        ...override.slaHours
      },

      keywords: Array.isArray(override.keywords)
        ? override.keywords
        : DEFAULT_RULES.keywords
    };

  } catch {
    return DEFAULT_RULES;
  }
};

export const rules = load();

export function prioritize(inc, now = Date.now()) {
  const w = rules.weights;
  const days = Math.max(0, (now - Date.parse(inc.createdAt)) / 864e5);
  const text = `${inc.description || ''} ${inc.landmark || ''}`.toLowerCase();
  const score = Math.round(
    (rules.severity[inc.category] ?? 2) * w.severity +
    Math.min(days * w.perDayOpen, w.ageCap) +
    (inc.photoKey ? w.photo : 0) +
    (rules.keywords.some(k => text.includes(k)) ? w.keyword : 0));
  const t = rules.thresholds;
  const priority = score >= t.urgent ? 'urgent' : score >= t.high ? 'high' : score >= t.medium ? 'medium' : 'low';
  return { priorityScore: score, priority };
}
export const dueAt = (createdAt, priority) =>
  new Date(Date.parse(createdAt) + rules.slaHours[priority] * 36e5).toISOString();
