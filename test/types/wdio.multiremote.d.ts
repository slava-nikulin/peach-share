/// <reference types="@wdio/globals/types" />
declare namespace WebdriverIO {
  interface MultiRemoteBrowser {
    OwnerBrowser: WebdriverIO.Browser;
    GuestBrowser: WebdriverIO.Browser;
  }
}
