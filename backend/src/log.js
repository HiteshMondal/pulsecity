// Structured JSON logs -> stdout -> CloudWatch Logs
export const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
