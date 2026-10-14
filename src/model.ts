import { createHash } from 'node:crypto';

export interface Attachment { id: string; name: string; mime_type: string | null }
export interface RawPosting {
  posting_id: string; title: string; employer: string;
  division?: string | null; location?: string | null; remote_type?: string | null;
  position_type?: string | null; term?: string | null; duration?: string | null;
  openings?: number | null; salary?: string | null; description?: string | null;
  qualifications?: string | null; application_method?: string | null;
  external_application_url?: string | null; application_deadline?: string | null;
  posted_date?: string | null; disciplines_or_programs?: string[] | null;
  work_authorization?: string | null;
  attachments?: Array<Attachment & { content_base64?: string }>;
  source_revision?: string | null; source_url?: string | null;
  application_status?: 'submitted' | 'not_submitted'; submitted_at?: string | null;
  application_status_label?: string | null;
  detail_fields?: Record<string, string>;
  source_posting_text?: string | null;
}
export interface SourceCapture {
  source: 'oscarplus_authenticated_detail'; format: 'text/plain';
  captured_at: string; sha256: string; text: string;
}
export interface Job {
  posting_id: string; source: 'oscarplus'; title: string; employer: string;
  division: string | null; location: string | null; remote_type: string | null;
  position_type: string | null; term: string | null; duration: string | null;
  openings: number | null; salary: string | null; description: string | null;
  qualifications: string | null; application_method: string | null;
  external_application_url: string | null; application_deadline: string | null;
  posted_date: string | null; disciplines_or_programs: string[];
  work_authorization: string | null; attachments: Attachment[];
  raw_source_metadata: { source_url: string | null };
  source_revision: string | null; content_hash: string;
  application_status: 'submitted' | 'not_submitted'; submitted_at: string | null;
  application_status_label: string | null;
  detail_fields: Record<string, string>;
  source_capture: SourceCapture | null;
  first_seen_at: string; last_seen_at: string; last_changed_at: string;
  listing_state: 'listed' | 'not_listed' | 'unknown';
  last_listing_check_at: string | null;
}
const clean = (value: string | null | undefined): string | null => value?.trim() || null;
export function normalize(raw: RawPosting, now: string): Job {
  if (!raw.posting_id.trim() || !raw.title.trim() || !raw.employer.trim()) throw new Error('invalid_posting');
  const sourceText = clean(raw.source_posting_text)?.replace(/\r\n?/g, '\n') ?? null;
  const source_capture: SourceCapture | null = sourceText ? {
    source: 'oscarplus_authenticated_detail', format: 'text/plain', captured_at: now,
    sha256: createHash('sha256').update(sourceText).digest('hex'), text: sourceText,
  } : null;
  const content = {
    posting_id: raw.posting_id.trim(), source: 'oscarplus' as const,
    title: raw.title.trim(), employer: raw.employer.trim(),
    division: clean(raw.division), location: clean(raw.location), remote_type: clean(raw.remote_type),
    position_type: clean(raw.position_type), term: clean(raw.term), duration: clean(raw.duration),
    openings: raw.openings ?? null, salary: clean(raw.salary), description: clean(raw.description),
    qualifications: clean(raw.qualifications), application_method: clean(raw.application_method),
    external_application_url: clean(raw.external_application_url), application_deadline: clean(raw.application_deadline),
    posted_date: clean(raw.posted_date), disciplines_or_programs: [...(raw.disciplines_or_programs ?? [])].map(x => x.trim()).sort(),
    work_authorization: clean(raw.work_authorization),
    attachments: (raw.attachments ?? []).map(({ id, name, mime_type }) => ({ id, name, mime_type: mime_type ?? null })).sort((a, b) => a.id.localeCompare(b.id)),
    application_status: raw.application_status ?? 'not_submitted', submitted_at: clean(raw.submitted_at),
    application_status_label: clean(raw.application_status_label),
    detail_fields: Object.fromEntries(Object.entries(raw.detail_fields ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key.trim(), value.trim()])),
    source_capture,
    // Source URLs may carry session IDs or tokens. Do not persist them.
    raw_source_metadata: { source_url: null }, source_revision: clean(raw.source_revision),
  };
  const { source_revision: _revision, source_capture: _capture, ...rest } = content;
  const hashContent = { ...rest, source_capture: _capture ? { source: _capture.source, sha256: _capture.sha256 } : null };
  const content_hash = createHash('sha256').update(JSON.stringify(hashContent)).digest('hex');
  return { ...content, content_hash, first_seen_at: now, last_seen_at: now, last_changed_at: now,
    listing_state: 'unknown', last_listing_check_at: null };
}
