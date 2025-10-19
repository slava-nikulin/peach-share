import { multiremotebrowser } from '@wdio/globals';

export type Role = 'owner' | 'guest';

const ROLE_TO_INSTANCE: Record<Role, 'OwnerBrowser' | 'GuestBrowser'> = {
  owner: 'OwnerBrowser',
  guest: 'GuestBrowser',
};

export const APP_URL = 'http://localhost:5173/';

export function getBrowserByRole(role: Role): WebdriverIO.Browser {
  return multiremotebrowser.getInstance(ROLE_TO_INSTANCE[role]);
}

export class Page {
  constructor(protected readonly role: Role) {}

  protected get browser(): WebdriverIO.Browser {
    return getBrowserByRole(this.role);
  }

  public async open(): Promise<void> {
    await this.browser.url(APP_URL);
  }

  public pause(ms: number): Promise<void> {
    return this.browser.pause(ms);
  }
}
