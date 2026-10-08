// All values are invented for a portfolio demonstration, not personal history.
export const DEMO_PASSWORD = "FictionalDemoOnly_2026!";
export const DEMO_TAG = "fictional-demo";

export function demoCheckins(now = new Date()) {
  return Array.from({ length: 14 }, (_, i) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - (13 - i));
    date.setUTCHours(12, 0, 0, 0);
    return {
      timestamp: date.toISOString(),
      entry_type: "DAILY_CHECKIN",
      plaintext: { fictional_demo: true, notes: `[FICTIONAL DEMO] Day ${i + 1}: invented observation after a short walk.` },
      openFields: { tags: [DEMO_TAG], mood_score: 4 + (i % 5), energy_score: 5 + (i % 4) },
    };
  });
}
