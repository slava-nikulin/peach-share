import { $ } from '@wdio/globals';
import { Page } from './_page.js';

/**
 * sub page containing specific selectors and methods for a specific page
 */
class SecurePage extends Page {
  /**
   * define selectors using getter methods
   */
  public get flashAlert(): ChainablePromiseElement {
    return $('#flash');
  }
}

export const securePage: SecurePage = new SecurePage();
