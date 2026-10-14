import { expect, it, vi } from 'vitest';
import { appliedStatus, collectListingRows, LiveOscarPlusProvider } from '../src/provider.js';

it('includes interview selections as submitted and preserves external intentions as unsubmitted', () => {
  expect(appliedStatus('Application SUBMITTED')).toBe('submitted');
  expect(appliedStatus('Selected for Interview')).toBe('submitted');
  expect(appliedStatus('Expressed Intention to Apply')).toBe('not_submitted');
  expect(appliedStatus('Application NOT SUBMITTED')).toBe('not_submitted');
  expect(() => appliedStatus('New unknown portal status')).toThrow('application_status_unrecognized');
});

it('follows actual page size until the advertised count is fully covered', async () => {
  const pages = [[{ posting_id: '1' }, { posting_id: '2' }], [{ posting_id: '3' }]];
  const next = vi.fn(async () => {});
  expect(await collectListingRows(3, async n => pages[n - 1]!, next)).toHaveLength(3);
  expect(next).toHaveBeenCalledExactlyOnceWith('1');
});
it.each([
  [[], []],
  [[{ posting_id: '1' }], [{ posting_id: '1' }]],
  [[{ posting_id: '1' }, { posting_id: '2' }, { posting_id: '3' }], []],
])('rejects incomplete, duplicated and overfull listings', async (first, second) => {
  await expect(collectListingRows(2, async n => n === 1 ? first : second, async () => {})).rejects.toThrow('listing_incomplete');
});
it('accepts a verified zero count without inventing rows', async () => {
  const read = vi.fn();
  expect(await collectListingRows(0, read, vi.fn())).toEqual([]);
  expect(read).not.toHaveBeenCalled();
});
it('fails a batch limit instead of silently declaring a truncated crawl complete', async () => {
  const provider = new LiveOscarPlusProvider({ username: '', password: '', sessionPath: '', batchLimit: 1 });
  const internals = provider as any;
  internals.dashboard = async () => [{ label: 'All Active Jobs - Spring - 2027', count: 2 }, { label: 'Applied To', count: 0 }];
  internals.openWidget = async () => {};
  internals.activeRows = async () => [{ posting_id: '1' }, { posting_id: '2' }];
  await expect(provider.listPostings()).rejects.toThrow('listing_limit_exceeded');
});
