export interface RoomKeyDeriver {
  derive(prs: string, drandRound: number, drandRandomness: string): string;
}

export class SimpleConcatDeriver implements RoomKeyDeriver {
  derive(prs: string, drandRound: number, drandRandomness: string): string {
    // Временно: конкатенация. Потом заменишь на Argon2(prs, salt=drandRandomness).
    return `${prs}:${drandRound}:${drandRandomness.slice(0, 16)}`;
  }
}
