import type { RawPosting } from './model.js';
import { chmodSync, existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { authenticate, AuthenticationError, initialAuthenticationStatus, type AuthenticationStatus, type AuthSnapshot } from './authentication.js';
export interface PostingSummary { posting_id: string; source_revision?: string | null }
export interface OscarPlusProvider {
  ensureAuthenticated(): Promise<void>;
  listPostings(): Promise<PostingSummary[]>;
  getPosting(postingId: string): Promise<RawPosting>;
  close?(): Promise<void>;
  authenticationStatus?(): AuthenticationStatus;
}
// Never treat a truncated, duplicated or unexpectedly empty page as a complete crawl.
export async function collectListingRows<T extends { posting_id: string }>(expected: number,
  readPage: (pageNumber: number) => Promise<T[]>, next: (firstId: string) => Promise<void>): Promise<T[]> {
  const rows: T[] = [];
  const ids = new Set<string>();
  for (let pageNumber = 1; rows.length < expected; pageNumber++) {
    const pageRows = await readPage(pageNumber);
    if (!pageRows.length) throw new Error('listing_incomplete');
    for (const row of pageRows) {
      if (ids.has(row.posting_id)) throw new Error('listing_incomplete');
      ids.add(row.posting_id);
      rows.push(row);
    }
    if (rows.length > expected) throw new Error('listing_incomplete');
    if (rows.length < expected) await next(pageRows[0]!.posting_id);
  }
  return rows;
}
export class FixtureOscarPlusProvider implements OscarPlusProvider {
  constructor(private readonly postings: RawPosting[]) {}
  async ensureAuthenticated(): Promise<void> {}
  async listPostings(): Promise<PostingSummary[]> { return this.postings.map(({ posting_id, source_revision }) => ({ posting_id, source_revision })); }
  async getPosting(postingId: string): Promise<RawPosting> {
    const job = this.postings.find(x => x.posting_id === postingId);
    if (!job) throw new Error('posting_not_found');
    return job;
  }
}
type Listing = {
  posting_id: string; title: string; employer: string; division: string | null;
  term: string | null; duration: string | null; location: string | null;
  openings: number | null; deadline: string | null;
  source_list: 'active' | 'applied'; filter_label: string; page_number: number;
  application_status: 'submitted' | 'not_submitted'; submitted_at: string | null;
  application_status_label?: string;
};
const origin = 'https://www.oscarplusmcmaster.ca';
const listingPath = '/myAccount/eng/coop/postings.htm';
const clean = (value: string | null | undefined): string | null => value?.trim() || null;

export function appliedStatus(label: string): 'submitted' | 'not_submitted' {
  if (/^(Application SUBMITTED|Selected for Interview)$/i.test(label.trim())) return 'submitted';
  if (/^(Expressed Intention to Apply|Application NOT SUBMITTED)$/i.test(label.trim())) return 'not_submitted';
  throw new Error('application_status_unrecognized');
}

function torontoDateTime(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\w+) (\d{1,2}), (\d{4})\s+@?\s*(\d{1,2}):(\d{2}) (AM|PM)$/i.exec(value.trim());
  if (!match) return null;
  const month = new Date(`${match[1]} 1, ${match[3]}`).getUTCMonth() + 1;
  if (!month || !match[2] || !match[3] || !match[4] || !match[5] || !match[6]) return null;
  const hour = Number(match[4]) % 12 + (match[6].toUpperCase() === 'PM' ? 12 : 0);
  const date = `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}T${String(hour).padStart(2, '0')}:${match[5]}:00`;
  const atUtc = new Date(`${date}Z`);
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', timeZoneName: 'shortOffset' })
    .formatToParts(atUtc).find(x => x.type === 'timeZoneName')?.value;
  const offset = /GMT([+-]\d{1,2})/.exec(part ?? '')?.[1];
  if (!offset) return null;
  return `${date}${offset.startsWith('-') ? '-' : '+'}${String(Math.abs(Number(offset))).padStart(2, '0')}:00`;
}

export interface LiveProviderOptions {
  username: string; password: string; sessionPath: string; batchLimit: number;
}
export class LiveOscarPlusProvider implements OscarPlusProvider {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private listing = new Map<string, Listing>();
  private current_view: string | null = null;
  private auth = initialAuthenticationStatus();
  constructor(private readonly options: LiveProviderOptions) {}
  authenticationStatus(): AuthenticationStatus { return { ...this.auth }; }
  private reportAuthentication(status: AuthenticationStatus): void {
    this.auth = { ...status };
    console.log(JSON.stringify({ event: 'oscarplus_authentication', ...status }));
  }

  async ensureAuthenticated(): Promise<void> {
    await this.close();
    this.auth = initialAuthenticationStatus();
    this.browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    this.context = await this.browser.newContext(existsSync(this.options.sessionPath)
      ? { storageState: this.options.sessionPath } : {});
    this.page = await this.context.newPage();
    this.reportAuthentication({ ...this.auth, stage: 'redirect', outcome: 'pending', updated_at: new Date().toISOString() });
    try { await this.page.goto(`${origin}/secure/ssoStudent.htm`, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
    catch (error) {
      const category = error instanceof Error && error.name === 'TimeoutError' ? 'authentication_redirect_timeout' : 'authentication_browser_error';
      this.reportAuthentication({ ...this.auth, outcome: 'failed', error_category: category, updated_at: new Date().toISOString() });
      throw new AuthenticationError(category);
    }
    await this.signIn();
    // Save renewed cookies even when the old session worked without an interactive sign-in.
    await this.context.storageState({ path: this.options.sessionPath });
    chmodSync(this.options.sessionPath, 0o600);
  }

  private isAccountPage(): boolean {
    return !!this.page && new URL(this.page.url()).hostname === 'www.oscarplusmcmaster.ca'
      && this.page.url().includes('/myAccount/');
  }

  private async signIn(): Promise<void> {
    const page = this.page!;
    const username = page.locator('input[name="loginfmt"], input[type="email"]').first();
    const password = page.locator('input[name="passwd"], input[type="password"]').first();
    const call = page.getByText(/^Call\s+(?:\+|me\b)/i).first();
    const otherMethods = page.getByText(/^(Sign in another way|Other ways to sign in|Use a different verification option)$/i).first();
    const visible = (locator: ReturnType<Page['locator']>) => locator.isVisible().catch(() => false);
    await authenticate({
      now: () => Date.now(), pause: ms => page.waitForTimeout(ms),
      snapshot: async (): Promise<AuthSnapshot> => {
        const url = new URL(page.url());
        if (this.isAccountPage()) return { route: 'account' };
        if (url.hostname === 'www.oscarplusmcmaster.ca') return { route: 'oscarplus', loggedOut: url.pathname === '/notLoggedIn.htm' };
        if (url.hostname !== 'login.microsoftonline.com') return { route: 'other' };
        const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
        const [accountPicker, hasUsername, hasPassword, phoneOption, hasOtherMethods] = await Promise.all([
          visible(page.getByText(/pick an account/i).first()), visible(username), visible(password), visible(call), visible(otherMethods),
        ]);
        return { route: 'microsoft', accountPicker, username: hasUsername, password: hasPassword,
          phoneOption, otherMethods: hasOtherMethods, staySignedIn: /stay signed in/i.test(body),
          credentialsRejected: /incorrect password|password is incorrect|account or password is incorrect/i.test(body),
          verificationRejected: /authentication failed|verification failed|we (?:couldn't|could not|weren't able to) call|did not receive (?:a|your) response|didn't receive (?:a|your) response/i.test(body),
          actionRequired: /more information required|keep your account secure|account has been locked|access has been blocked/i.test(body) };
      },
      act: async action => {
        if (action === 'retry_sso') {
          await this.context!.clearCookies({ domain: /^\.?(?:www\.)?oscarplusmcmaster\.ca$/i });
          await page.goto(`${origin}/secure/ssoStudent.htm`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } else {
          // Credentials and verification choices are only acted on at the Microsoft host.
          if (new URL(page.url()).hostname !== 'login.microsoftonline.com') throw new Error('authentication_required');
          if (action === 'choose_account') {
            const tile = page.getByText(this.options.username, { exact: true }).first();
            if (await visible(tile)) await tile.click();
            else await page.getByText(/use another account/i).first().click();
          } else if (action === 'enter_username' || action === 'enter_password') {
            await (action === 'enter_username' ? username : password).fill(action === 'enter_username' ? this.options.username : this.options.password);
            await page.locator('#idSIButton9, input[type="submit"]').first().click();
          } else if (action === 'choose_phone') await call.click();
          else if (action === 'other_methods') await otherMethods.click();
          else if (action === 'stay_signed_in') await page.locator('#idSIButton9').click();
        }
      },
    }, status => this.reportAuthentication(status));
  }

  private async dashboard(): Promise<Array<{ label: string; count: number }>> {
    const page = this.page;
    if (!page) throw new Error('authentication_required');
    await page.goto(`${origin}${listingPath}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (new URL(page.url()).pathname === '/notLoggedIn.htm') throw new Error('authentication_required');
    await page.waitForFunction(() => {
      const widgets = [...document.querySelectorAll('tr')].map(row => ({
        label: (row.querySelector('td.full') as HTMLElement | null)?.innerText ?? '',
        value: row.querySelector('td.value')?.textContent?.trim() ?? '',
      })).filter(row => row.label.includes('All Active Jobs -') || row.label.trim() === 'Applied To');
      return widgets.some(row => row.label.includes('All Active Jobs -'))
        && widgets.some(row => row.label.trim() === 'Applied To')
        && widgets.every(row => /^\d+$/.test(row.value));
    }, undefined, { timeout: 20000 });
    this.current_view = null;
    return page.evaluate(() => [...document.querySelectorAll('tr')].map(row => ({
      label: (row.querySelector('td.full') as HTMLElement | null)?.innerText.trim() ?? '',
      count: Number(row.querySelector('td.value')?.textContent?.trim() ?? '0'),
    })).filter(row => row.label));
  }

  private async openWidget(label: string, expectedCount: number): Promise<void> {
    const page = this.page!;
    const clicked = await page.evaluate(selected => {
      const row = [...document.querySelectorAll('tr')].find(candidate =>
        (candidate.querySelector('td.full') as HTMLElement | null)?.innerText.trim() === selected);
      const link = row?.querySelector('td.full a') as HTMLAnchorElement | null;
      link?.click();
      return !!link;
    }, label);
    if (!clicked) throw new Error('listing_unavailable');
    if (expectedCount > 0) await page.waitForFunction(() => [...document.querySelectorAll('tr')]
      .some(row => [...row.querySelectorAll('td')].some(cell => /^\d{6}$/.test(cell.textContent?.trim() ?? ''))),
    undefined, { timeout: 20000 });
  }

  private async nextPage(previousFirstId: string): Promise<void> {
    const page = this.page!;
    const clicked = await page.evaluate(() => {
      const link = [...document.querySelectorAll('a')].find(element => (element.textContent ?? '').trim() === '»'
        && !element.parentElement?.classList.contains('disabled')) as HTMLAnchorElement | undefined;
      link?.click();
      return !!link;
    });
    if (!clicked) throw new Error('listing_unavailable');
    await page.waitForFunction(previous => {
      const row = [...document.querySelectorAll('tr')].find(candidate => [...candidate.querySelectorAll('td')]
        .some(cell => /^\d{6}$/.test(cell.textContent?.trim() ?? '')));
      return row && [...row.querySelectorAll('td')].some(cell => /^\d{6}$/.test(cell.textContent?.trim() ?? '')
        && cell.textContent?.trim() !== previous);
    }, previousFirstId, { timeout: 20000 });
  }

  private async activeRows(label: string, pageNumber: number): Promise<Listing[]> {
    return this.page!.evaluate(({ label, pageNumber }) => [...document.querySelectorAll('tr')].map(row => {
      const cells = [...row.querySelectorAll('td')];
      const id = cells[3]?.innerText.trim() ?? '';
      if (!/^\d{6}$/.test(id)) return null;
      return {
        posting_id: id, title: cells[4]?.querySelector('a')?.textContent?.trim() ?? '',
        employer: cells[5]?.innerText.trim() ?? '', division: cells[6]?.innerText.trim() ?? null,
        term: cells[2]?.innerText.trim() ?? null, duration: cells[7]?.innerText.trim() ?? null,
        location: cells[8]?.innerText.trim() ?? null, openings: Number(cells[9]?.innerText.trim() ?? '') || null,
        deadline: cells[10]?.innerText.trim() ?? null, source_list: 'active' as const,
        filter_label: label, page_number: pageNumber,
        application_status: 'not_submitted' as const, submitted_at: null,
      };
    }).filter((row): row is NonNullable<typeof row> => row !== null), { label, pageNumber });
  }

  private async appliedRows(pageNumber: number): Promise<Listing[]> {
    const rows = await this.page!.evaluate(pageNumber => [...document.querySelectorAll('tr')].map(row => {
      const cells = [...row.querySelectorAll('td')];
      const id = cells[2]?.innerText.trim() ?? '';
      if (!/^\d{6}$/.test(id)) return null;
      return {
        posting_id: id, title: cells[3]?.innerText.trim() ?? '',
        employer: cells[4]?.innerText.trim() ?? '', division: cells[5]?.innerText.trim() ?? null,
        term: cells[1]?.innerText.trim() ?? null, duration: null,
        location: cells[13]?.innerText.trim() ?? null, openings: Number(cells[11]?.innerText.trim() ?? '') || null,
        deadline: cells[8]?.innerText.trim() ?? null, submitted: cells[9]?.innerText.trim() ?? null,
        application_status_label: cells[7]?.innerText.trim() ?? '',
        source_list: 'applied' as const, filter_label: 'Applied To', page_number: pageNumber,
      };
    }).filter((row): row is NonNullable<typeof row> => row !== null), pageNumber);
    return rows.map(row => {
      const application_status = appliedStatus(row.application_status_label);
      return { ...row, application_status, submitted_at: application_status === 'submitted' ? torontoDateTime(row.submitted) : null };
    });
  }

  async listPostings(): Promise<PostingSummary[]> {
    this.listing.clear();
    const widgets = await this.dashboard();
    for (const widget of widgets.filter(x => x.label.startsWith('All Active Jobs -') && x.count > 0)) {
      await this.dashboard();
      await this.openWidget(widget.label, widget.count);
      const rows = await collectListingRows(widget.count, n => this.activeRows(widget.label, n), id => this.nextPage(id));
      for (const row of rows) if (!this.listing.has(row.posting_id)) this.listing.set(row.posting_id, row);
    }
    const appliedWidget = (await this.dashboard()).find(x => x.label === 'Applied To');
    if (appliedWidget && appliedWidget.count > 0) {
      await this.openWidget('Applied To', appliedWidget.count);
      const rows = await collectListingRows(appliedWidget.count, n => this.appliedRows(n), id => this.nextPage(id));
      for (const row of rows) {
        const existing = this.listing.get(row.posting_id);
        this.listing.set(row.posting_id, existing ? {
          ...existing, application_status: row.application_status, submitted_at: row.submitted_at,
          application_status_label: row.application_status_label,
        } : row);
      }
    }
    if (this.listing.size > this.options.batchLimit) throw new Error('listing_limit_exceeded');
    return [...this.listing.keys()].map(posting_id => ({ posting_id, source_revision: null }));
  }

  async getPosting(postingId: string): Promise<RawPosting> {
    const summary = this.listing.get(postingId);
    if (!summary) throw new Error('posting_not_found');
    const key = `${summary.filter_label}:${summary.page_number}`;
    const page = this.page!;
    if (this.current_view !== key) {
      const widgets = await this.dashboard();
      const widget = widgets.find(item => item.label === summary.filter_label);
      if (!widget) throw new Error('listing_unavailable');
      await this.openWidget(widget.label, widget.count);
      const onPage = async () => page.evaluate(id => [...document.querySelectorAll('tr')]
        .some(row => [...row.querySelectorAll('td')].some(cell => cell.textContent?.trim() === id)), postingId);
      if (!await onPage()) {
        const clickedPage = await page.evaluate(pageNumber => {
          const link = [...document.querySelectorAll('a')].find(anchor => anchor.textContent?.trim() === String(pageNumber));
          link?.click();
          return !!link;
        }, summary.page_number);
        if (!clickedPage) throw new Error('listing_unavailable');
        await page.waitForFunction(id => [...document.querySelectorAll('tr')]
          .some(row => [...row.querySelectorAll('td')].some(cell => cell.textContent?.trim() === id)),
        postingId, { timeout: 20000 });
      }
      this.current_view = key;
    }
    const popupPromise = this.context!.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    const clicked = await page.evaluate(({ id, source }) => {
      const row = [...document.querySelectorAll('tr')].find(candidate => [...candidate.querySelectorAll('td')]
        .some(cell => cell.textContent?.trim() === id));
      const link = source === 'active' ? row?.querySelector('td.orgDivTitleMaxWidth a')
        : [...(row?.querySelectorAll('a') ?? [])].find(anchor => anchor.textContent?.trim().toLowerCase() === 'view');
      (link as HTMLAnchorElement | undefined)?.click();
      return !!link;
    }, { id: postingId, source: summary.source_list });
    if (!clicked) throw new Error('posting_not_found');
    const detailPage = await popupPromise ?? page;
    await detailPage.waitForLoadState('domcontentloaded').catch(() => {});
    await detailPage.waitForFunction(() => [...document.querySelectorAll('td > strong')]
      .some(label => label.textContent?.trim() === 'Position Description:'), undefined, { timeout: 15000 });
    const targetedPrograms = detailPage.getByText('View Targeted Programs', { exact: true }).first();
    if (await targetedPrograms.isVisible().catch(() => false)) {
      await targetedPrograms.click();
      await detailPage.waitForFunction(() => {
        const label = [...document.querySelectorAll('td > strong')].find(item =>
          item.textContent?.trim() === 'Targeted Degrees and Disciplines:');
        const value = (label?.parentElement?.nextElementSibling as HTMLElement | null)?.innerText?.trim() ?? '';
        return value.split('\n').map(line => line.trim()).filter(Boolean).length > 1;
      }, undefined, { timeout: 10000 });
    }
    const entries = await detailPage.evaluate(() => [...document.querySelectorAll('td > strong')]
      .filter(label => (label.textContent ?? '').trim().endsWith(':'))
      .map(label => ({
        label: (label.textContent ?? '').trim().replace(/:$/, ''),
        value: (label.parentElement?.nextElementSibling as HTMLElement | null)?.innerText?.trim() ?? '',
      })));
    const fields = Object.fromEntries(entries.map(({ label, value }) => [label, value]));
    const source_posting_text = entries.map(({ label, value }) => `${label}:\n${value}`).join('\n\n');
    const disciplines_or_programs = (fields['Targeted Degrees and Disciplines'] ?? '').split('\n')
      .map(line => line.trim()).filter(line => line && line !== 'View Targeted Programs');
    if (detailPage !== page) await detailPage.close();
    else this.current_view = null;
    const title = clean(fields['Position Title']) ?? summary.title;
    if (!title || !summary.employer) throw new Error('invalid_posting');
    return {
      posting_id: postingId, title, employer: summary.employer,
      division: summary.division, location: clean(fields['Work Location - City, Prov/State']) ?? summary.location,
      remote_type: clean(fields['Position Location']), position_type: clean(fields['Position Type']),
      term: clean(fields['Term Posted']) ?? summary.term, duration: summary.duration,
      openings: Number(fields['Number of Positions']) || summary.openings,
      salary: clean(fields['Salary']), description: clean(fields['Position Description']),
      qualifications: clean(fields['Position Requirements']),
      application_method: clean(fields['Application Method']),
      application_deadline: torontoDateTime(clean(fields['Application Deadline']) ?? summary.deadline),
      posted_date: null, disciplines_or_programs, work_authorization: null,
      attachments: [], source_revision: null, source_url: null,
      application_status: summary.application_status, submitted_at: summary.submitted_at,
      application_status_label: summary.application_status_label ?? null,
      detail_fields: fields, source_posting_text,
    };
  }

  async close(): Promise<void> {
    const context = this.context, browser = this.browser;
    this.context = null; this.browser = null; this.page = null;
    this.listing.clear();
    this.current_view = null;
    try { await context?.close(); } finally { await browser?.close(); }
  }
}
