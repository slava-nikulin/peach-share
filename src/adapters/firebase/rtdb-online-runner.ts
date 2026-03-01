import type { Database } from 'firebase/database';
import type { UseCaseRunner } from '../../bll/ports/usecase-runner';
import { RtdbConnectionScope } from './rtdb-connection-scope';

export class RtdbOnlineRunner implements UseCaseRunner {
  private readonly scope: RtdbConnectionScope;

  constructor(db: Database) {
    this.scope = new RtdbConnectionScope(db);
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.scope.run(async () => fn());
  }
}
