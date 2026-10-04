import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeError } from './errors.mjs';

const id = z.string().trim().min(1).max(512);
export const tools = {
  get_context: { description: 'Read the single connected MarginNote study window, notebook, document and focused note. Multiple windows return AMBIGUOUS_CONTEXT.', schema: z.object({}).strict() },
  search_notes: { description: 'Search notes across all notebooks, or one explicit notebook_id. Results have stable note IDs; results at the limit may be incomplete.', schema: z.object({ query: z.string().trim().min(1).max(2000), notebook_id: id.optional(), limit: z.number().int().min(1).max(100).default(30) }).strict() },
  get_note: { description: 'Read a MarginNote note by the stable note_id returned from context or search. Large text and child lists are bounded and flagged.', schema: z.object({ note_id: id }).strict() },
  get_current_pdf: { description: 'Get the local file path and current page index of the PDF open in MarginNote. No PDF contents are returned. Open file_path locally to read or render page_number (1-based); page_index is 0-based. Call again after switching documents or pages.', schema: z.object({}).strict() },
};
export function validate(tool, args) {
  if (!Object.hasOwn(tools, tool)) throw new BridgeError('INVALID_ARGUMENT', 'Unsupported tool');
  const result = tools[tool].schema.safeParse(args);
  if (!result.success) throw new BridgeError('INVALID_ARGUMENT', 'Arguments do not match the tool schema');
  return result.data;
}
export function nativeArguments(tool, args) {
  if (tool === 'search_notes') return { query: args.query, scope: args.notebook_id ? 'topic' : 'all', ...(args.notebook_id ? { topicId: args.notebook_id } : {}), limit: args.limit };
  if (tool === 'get_note') return { noteId: args.note_id, includeChildren: false };
  return {};
}
export function normalize(tool, value, args) {
  let truncated = false;
  const text = (v) => {
    if (typeof v !== 'string') return '';
    if (v.length > 20000) truncated = true;
    return v.slice(0, 20000);
  };
  const identifier = (v) => typeof v === 'string' && v.length ? v : null;
  const list = (v) => {
    if (!Array.isArray(v)) return [];
    if (v.length > 100) truncated = true;
    return v.slice(0, 100);
  };
  const note = (v) => v && typeof v === 'object' ? {
    note_id: identifier(v.noteId), notebook_id: identifier(v.notebookId || v.topicId), document_id: identifier(v.docMd5), title: text(v.title), excerpt: text(v.excerptText || v.text), content: text(v.notesText),
    comments: list(v.comments).map(c => ({ type: text(c.type), text: text(c.text) })),
    children: list(v.children).map(c => ({ note_id: identifier(c.noteId), title: text(c.title) })),
    parent_note_id: identifier(v.parentNoteId), native_start_page: v.startPage ?? null, native_end_page: v.endPage ?? null,
  } : null;
  let output;
  if (tool === 'get_context') {
    output = { available: value?.available === true, reason: value?.available ? null : 'NO_ACTIVE_CONTEXT', window_id: identifier(value?.windowId), notebook: value?.notebook ? { notebook_id: identifier(value.notebook.topicId), title: text(value.notebook.title) } : null, document: value?.document ? { document_id: identifier(value.document.docMd5), title: text(value.document.title), page_count: value.document.pageCount ?? null } : null, focus_note: note(value?.focusNote), selection_text: text(value?.selectionText) };
  } else if (tool === 'search_notes') {
    if (!Array.isArray(value)) throw new BridgeError('RPC_FAILURE', 'Invalid native search response');
    const results = value.filter(n => n && typeof n.noteId === 'string' && n.noteId);
    output = { notes: results.slice(0, args.limit).map(note), possibly_truncated: value.length >= args.limit, omitted_without_note_id: value.length - results.length };
  } else if (tool === 'get_current_pdf') {
    if (!value || typeof value.filePath !== 'string' || !Number.isInteger(value.pageIndex) || value.pageIndex < 0) throw new BridgeError('RPC_FAILURE', 'Invalid native PDF location');
    let filePath = value.filePath;
    if (filePath.startsWith('file://')) {
      try { filePath = fileURLToPath(filePath); }
      catch { throw new BridgeError('PDF_PATH_UNAVAILABLE', 'Current PDF file URL is invalid'); }
    }
    if (!path.isAbsolute(filePath) || filePath.includes('\0') || filePath.length > 4096) throw new BridgeError('PDF_PATH_UNAVAILABLE', 'Current PDF file path is unavailable');
    output = { document_id: identifier(value.docMd5), title: text(value.title), file_path: filePath, file_name: path.basename(filePath), page_index: value.pageIndex, page_number: value.pageIndex + 1, page_count: Number.isInteger(value.pageCount) ? value.pageCount : null };
  } else {
    if (!value?.noteId || value.noteId !== args.note_id) throw new BridgeError('RPC_FAILURE', 'Native response did not match requested note');
    output = { note: note(value) };
  }
  return { ...output, truncated: truncated || Boolean(value?.truncated) };
}
