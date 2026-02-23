export interface OtpClientPort {
  getOtp(round?: number): Promise<[Uint8Array, number]>;
  currentRound(): number;
}
