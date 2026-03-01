export interface UseCaseRunner {
  run<T>(fn: () => Promise<T>): Promise<T>;
}
