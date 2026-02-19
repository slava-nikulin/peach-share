import { multiremotebrowser } from '@wdio/globals';

export type Role = 'owner' | 'guest';

const ROLE_TO_INSTANCE: Record<Role, 'OwnerBrowser' | 'GuestBrowser'> = {
  owner: 'OwnerBrowser',
  guest: 'GuestBrowser',
};

const fallbackAppUrl = 'http://localhost:5173/';
export const APP_URL: string = process.env.APP_URL ?? fallbackAppUrl;

export function getBrowserByRole(role: Role): WebdriverIO.Browser {
  return multiremotebrowser.getInstance(ROLE_TO_INSTANCE[role]);
}

export class Page {
  protected readonly role: Role;

  constructor(role: Role) {
    this.role = role;
  }

  protected get browser(): WebdriverIO.Browser {
    return getBrowserByRole(this.role);
  }

  public async open(path: string = '/'): Promise<void> {
    const url = new URL(path, APP_URL).toString();
    await this.browser.url(url);
  }

  public pause(ms: number): Promise<void> {
    return this.browser.pause(ms);
  }

  public async back(): Promise<void> {
    await this.browser.back();
  }

  public async forward(): Promise<void> {
    await this.browser.forward();
  }
}
