import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeError } from './errors.mjs';

// Stable Host/Add-on RPC primitives. These are not advertised as public MCP tools.

const id = z.string().trim().min(1).max(512);
const page = z.object({ offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict();
const move = z.object({ note_id: id, parent_note_id: id.nullable(), before_note_id: id.optional() }).strict();
const moves = z.array(move).min(1).max(20);
export const tools = {
  get_context: { description: 'Call for questions about what is currently open or selected in MarginNote: the study window, notebook, PDF and focused card. Refresh for each new live-context question because the selection can change. No selected card is represented by a null focus_note; multiple windows return AMBIGUOUS_CONTEXT.', schema: z.object({}).strict() },
  search_notes: { description: 'Search notes across all notebooks, or one explicit notebook_id. Results have stable note IDs; results at the limit may be incomplete.', schema: z.object({ query: z.string().trim().min(1).max(2000), notebook_id: id.optional(), limit: z.number().int().min(1).max(100).default(30) }).strict() },
  get_note: { description: 'Read typed text, excerpt, comments and child IDs of a MarginNote card using a note_id from context or search. Handwriting and images can be absent from these text fields; for the selected card also call get_current_card_image when answering what it contains. Large fields are bounded and flagged.', schema: z.object({ note_id: id }).strict() },
  get_note_media: { description: 'Read visual media of a known MarginNote card by note_id, especially handwritten notes, images, diagrams or linked mind-map sketches. Returns an MCP image and image_file_path when renderable. If your client shows only stroke_count/metadata, open image_file_path with its local image-reading tool; stroke_count is not the image content. source=sketch reads a linked sketch; source=focus_image renders a matching focused document note. media_index is zero-based.', schema: z.object({ note_id: id, source: z.enum(['note', 'sketch', 'focus_image']).default('note'), media_index: z.number().int().min(0).max(100).default(0) }).strict() },
  get_current_pdf: { description: 'Call when the user asks which PDF or page is currently open in MarginNote. Returns local PDF path and zero-based page_index; page_number is the physical PDF position, while MarginNote and printed page labels can differ. No page content is returned. Refresh after switching documents or pages.', schema: z.object({}).strict() },
  list_notebooks: { description: 'List MarginNote study sets (not PDFs) with offset pagination. Iterate until next_offset is null to cover the library.', schema: page },
  get_library_page: { description: 'Read all notebook cards or a root card subtree in bounded pages with an accurate total_count, stable IDs, parents and order. Pass snapshot_id on following pages; restart if STALE_SNAPSHOT. Use get_note for truncated content.', schema: z.object({ notebook_id: id, root_note_id: id.optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(30), snapshot_id: id.optional() }).strict() },
  create_card: { description: 'Create one card in an explicit MarginNote notebook, optionally under a parent card, with an optional Markdown comment. Writes to MarginNote; after an unknown timeout, inspect the notebook before retrying.', schema: z.object({ notebook_id: id, title: z.string().trim().min(1).max(500), parent_note_id: id.optional(), body: z.string().max(10000).optional() }).strict(), writes: true },
  append_comment: { description: 'Append a text or Markdown note to an existing card. This is a write and must not be retried blindly after an unknown timeout.', schema: z.object({ note_id: id, text: z.string().min(1).max(10000), format: z.enum(['text', 'markdown']).default('markdown') }).strict(), writes: true },
  create_framework: { description: 'Create up to 30 ordered mind-map cards from a conversation-derived outline in an explicit notebook. parent_key refers to an earlier node; body becomes a Markdown comment. This writes to MarginNote and cannot safely be retried after an unknown timeout; inspect the notebook first.', schema: z.object({ notebook_id: id, parent_note_id: id.optional(), nodes: z.array(z.object({ key: id, parent_key: id.optional(), title: z.string().trim().min(1).max(500), body: z.string().max(10000).optional() }).strict()).min(1).max(30) }).strict(), writes: true },
  promote_excerpt_to_title: { description: 'Set a card title from its current excerpt text while preserving the excerpt. Requires exact expected_excerpt_text to prevent stale edits. Writes to MarginNote.', schema: z.object({ note_id: id, expected_excerpt_text: z.string().trim().min(1).max(20000) }).strict(), writes: true },
  preview_reorganization: { description: 'Validate and preview up to 20 card moves within one notebook. parent_note_id=null moves a card to the root. Returns snapshot_id and plan_id. This does not write.', schema: z.object({ notebook_id: id, moves }).strict() },
  apply_reorganization: { description: 'Apply exactly the card moves previously previewed and reviewed with the user. Requires preview snapshot_id and plan_id, and rejects changed notebooks. Writes to MarginNote; after an unknown timeout, read cards before retrying.', schema: z.object({ notebook_id: id, expected_snapshot_id: id, expected_plan_id: id, moves }).strict(), writes: true },
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
  if (tool === 'get_note_media') return { noteId: args.note_id, source: args.source, mediaIndex: args.media_index };
  if (tool === 'get_library_page') return { topicId: args.notebook_id, offset: args.offset, limit: args.limit, ...(args.root_note_id ? { rootNoteId: args.root_note_id } : {}), ...(args.snapshot_id ? { snapshotId: args.snapshot_id } : {}) };
  if (tool === 'list_notebooks') return { offset: args.offset, limit: args.limit };
  if (tool === 'create_card') return { topicId: args.notebook_id, title: args.title, ...(args.parent_note_id ? { parentNoteId: args.parent_note_id } : {}), ...(args.body ? { comment: args.body, commentFormat: 'markdown' } : {}) };
  if (tool === 'append_comment') return { noteId: args.note_id, text: args.text, format: args.format };
  if (tool === 'create_framework') return { topicId: args.notebook_id, ...(args.parent_note_id ? { parentNoteId: args.parent_note_id } : {}), nodes: args.nodes.map(n => ({ key: n.key, ...(n.parent_key ? { parentKey: n.parent_key } : {}), title: n.title, ...(n.body ? { body: n.body } : {}) })) };
  if (tool === 'promote_excerpt_to_title') return { noteId: args.note_id, expectedExcerptText: args.expected_excerpt_text };
  if (tool === 'preview_reorganization' || tool === 'apply_reorganization') return { topicId: args.notebook_id, ...(args.expected_snapshot_id ? { expectedSnapshotId: args.expected_snapshot_id } : {}), ...(args.expected_plan_id ? { expectedPlanId: args.expected_plan_id } : {}), moves: args.moves.map(m => ({ noteId: m.note_id, parentNoteId: m.parent_note_id, ...(m.before_note_id ? { beforeNoteId: m.before_note_id } : {}) })) };
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
    comments: list(v.comments).map(c => ({ type: text(c.type), text: text(c.text), note_id: identifier(c.noteId) })),
    children: list(v.children).map(c => ({ note_id: identifier(c.noteId), title: text(c.title) })),
    parent_note_id: identifier(v.parentNoteId), native_start_page: v.startPage ?? null, native_end_page: v.endPage ?? null,
    media_count: Number.isInteger(v.mediaCount) ? v.mediaCount : null, stroke_count: Number.isInteger(v.strokeCount) ? v.strokeCount : null,
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
    output = { document_id: identifier(value.docMd5), title: text(value.title), file_path: filePath, file_name: path.basename(filePath), page_index: value.pageIndex, page_number: value.pageIndex + 1, margin_note_page_no: Number.isInteger(value.marginNotePageNo) && value.marginNotePageNo >= 0 ? value.marginNotePageNo : null, mapped_page_no: Number.isInteger(value.mappedPageNo) && value.mappedPageNo >= 0 ? value.mappedPageNo : null, page_count: Number.isInteger(value.pageCount) ? value.pageCount : null };
  } else if (tool === 'get_note_media') {
    if (value?.noteId !== args.note_id || value.source !== args.source || !Number.isInteger(value.mediaCount) || value.mediaCount < 0) throw new BridgeError('RPC_FAILURE', 'Invalid native media response');
    let mimeType = null;
    let mediaFormat = value.available ? 'binary' : null;
    let imageBase64 = null;
    if (value.available) {
      if (typeof value.base64 !== 'string' || value.base64.length > 1200000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64)) throw new BridgeError('RPC_FAILURE', 'Invalid native media data');
      const bytes = Buffer.from(value.base64, 'base64');
      if (bytes.length !== value.byteCount || bytes.length > 900000) throw new BridgeError('RPC_FAILURE', 'Invalid native media size');
      if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { mimeType = 'image/png'; mediaFormat = 'png'; }
      else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) { mimeType = 'image/jpeg'; mediaFormat = 'jpeg'; }
      else if (bytes.subarray(0, 4).toString() === '%PDF') mediaFormat = 'pdf';
      else if (bytes.subarray(0, 3).toString() === 'wrd') mediaFormat = 'wrd_binary';
      else if (bytes.subarray(0, 8).toString() === 'bplist00') mediaFormat = 'archived_media';
      else if (bytes[0] === 91 || bytes[0] === 123) mediaFormat = 'json_data';
      if (mimeType) imageBase64 = value.base64;
    }
    output = { note_id: args.note_id, source: value.source, media_note_id: identifier(value.mediaNoteId), media_count: value.mediaCount,
      media_index: value.mediaIndex, media_hash: /^[a-fA-F0-9]{32}$/.test(value.mediaHash || '') ? value.mediaHash.toLowerCase() : null, stroke_count: Number.isInteger(value.strokeCount) ? value.strokeCount : null,
      excerpt_picture_available: Boolean(value.excerptPictureAvailable), byte_count: value.byteCount ?? null,
      media_format: mediaFormat, image_mime_type: mimeType, image_base64: imageBase64,
      available: Boolean(value.available), reason: value.reason || null,
      ocr_text: value.ocr_text ?? null, ocr_engine: value.ocr_engine ?? null };
  } else if (tool === 'list_notebooks') {
    if (!Array.isArray(value?.notebooks)) throw new BridgeError('RPC_FAILURE', 'Invalid native notebook page');
    output = { total_count: value.totalCount, next_offset: value.nextOffset, notebooks: value.notebooks.map(n => ({ notebook_id: identifier(n.topicId), title: text(n.title), document_id: identifier(n.mainDocMd5), root_note_count: n.rootNoteCount })) };
  } else if (tool === 'get_library_page') {
    if (value?.topicId !== args.notebook_id || !Array.isArray(value.cards)) throw new BridgeError('RPC_FAILURE', 'Invalid native library page');
    output = { notebook_id: value.topicId, root_note_id: identifier(value.rootNoteId), snapshot_id: value.snapshotId, total_count: value.totalCount, next_offset: value.nextOffset, cards: value.cards.map(c => ({ note_id: identifier(c.noteId), parent_note_id: identifier(c.parentNoteId), order: c.order, document_id: identifier(c.docMd5), title: text(c.title), excerpt: text(c.excerptText), content: text(c.notesText), content_truncated: Boolean(c.contentTruncated), media_count: Number.isInteger(c.mediaCount) ? c.mediaCount : null, has_visual_content: typeof c.hasVisualContent === "boolean" ? c.hasVisualContent : null, comment_count: c.commentCount, comments: list(c.comments).map(x => ({ type: text(x.type), text: text(x.text), note_id: identifier(x.noteId), truncated: Boolean(x.truncated) })), comments_truncated: Boolean(c.commentsTruncated), summary_link_ids: list(c.summaryLinkIds).map(identifier), summary_links_truncated: Boolean(c.summaryLinksTruncated) })) };
  } else if (tool === 'create_framework') {
    if (value?.topicId !== args.notebook_id || !Array.isArray(value.cards)) throw new BridgeError('RPC_FAILURE', 'Invalid native framework result');
    output = { notebook_id: value.topicId, all_verified: value.allVerified === true, cards: value.cards.map(c => ({ key: c.key, note_id: identifier(c.noteId), parent_note_id: identifier(c.parentNoteId), title: text(c.title), verified: c.verified === true, body_verified: typeof c.bodyVerified === 'boolean' ? c.bodyVerified : null })) };
  } else if (tool === 'create_card' || tool === 'append_comment') {
    if (!value?.noteId || (tool === 'append_comment' && value.noteId !== args.note_id)) throw new BridgeError('RPC_FAILURE', 'Invalid native card result');
    output = { note: note(value) };
  } else if (tool === 'promote_excerpt_to_title') {
    if (value?.noteId !== args.note_id) throw new BridgeError('RPC_FAILURE', 'Native title result did not match requested card');
    output = { note_id: value.noteId, title: text(value.title), excerpt: text(value.excerptText) };
  } else if (tool === 'preview_reorganization' || tool === 'apply_reorganization') {
    if (value?.topicId !== args.notebook_id || !Array.isArray(value.moves)) throw new BridgeError('RPC_FAILURE', 'Invalid native reorganization result');
    output = { notebook_id: value.topicId, ...(tool === 'preview_reorganization' ? { snapshot_id: value.snapshotId, plan_id: value.planId } : { all_verified: value.allVerified === true }), moves: value.moves.map(m => ({ note_id: identifier(m.noteId), from_parent_note_id: identifier(m.fromParentNoteId), to_parent_note_id: identifier(m.toParentNoteId), before_note_id: identifier(m.beforeNoteId), title: text(m.title), ...(tool === 'apply_reorganization' ? { verified: m.verified === true } : {}) })) };
  } else {
    if (!value?.noteId || value.noteId !== args.note_id) throw new BridgeError('RPC_FAILURE', 'Native response did not match requested note');
    output = { note: note(value) };
  }
  return { ...output, truncated: truncated || Boolean(value?.truncated) };
}
