/** Review reveal policy: a review becomes public when both parties have submitted, or when the window closes. */
export const REVIEW_WINDOW_DAYS = 14;

export function reviewWindowOpen(completedAt: Date, now = new Date()): boolean {
  return now.getTime() <= completedAt.getTime() + REVIEW_WINDOW_DAYS * 86400_000;
}

export function revealTime(input: { completedAt: Date; bothSubmitted: boolean; now?: Date }): Date | null {
  const now = input.now ?? new Date();
  if (input.bothSubmitted) return now;
  const closes = new Date(input.completedAt.getTime() + REVIEW_WINDOW_DAYS * 86400_000);
  return now >= closes ? closes : null;
}

export function averageRating(ratings: number[]): { average: number | null; count: number } {
  if (ratings.length === 0) return { average: null, count: 0 };
  const sum = ratings.reduce((a, r) => a + r, 0);
  return { average: Math.round((sum / ratings.length) * 10) / 10, count: ratings.length };
}
