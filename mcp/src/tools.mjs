import { z } from 'zod';
import { tools as rpc } from './rpc-tools.mjs';

const id = z.string().trim().min(1).max(512);
const nullableId = id.nullable();
const count = z.number().int().nonnegative();
const comment = z.object({ type: z.string(), text: z.string(), note_id: nullableId.default(null) });
export const cardSchema = z.object({
  note_id: id, notebook_id: nullableId, document_id: nullableId,
  title: z.string(), excerpt: z.string(), content: z.string(), comments: z.array(comment),
  children: z.array(z.object({ note_id: nullableId, title: z.string() })), parent_note_id: nullableId,
  native_start_page: z.number().nullable(), native_end_page: z.number().nullable(),
  media_count: count.nullable().default(null), stroke_count: count.nullable().default(null),
});
export const mediaSchema = z.object({
  source: z.enum(['note', 'sketch', 'focus_image']), requested_note_id: id, media_note_id: nullableId,
  media_index: count.nullable(), media_hash: z.string().nullable(), media_format: z.string().nullable(),
  stroke_count: count.nullable(), byte_count: count.nullable(), status: z.enum(['image', 'unrenderable']),
  reason: z.string().nullable(), image_source: z.string().nullable(), image_mime_type: z.enum(['image/png', 'image/jpeg']).nullable(),
  image_file_path: z.string().nullable(), image_byte_count: count.nullable(),
  ocr_text: z.string().nullable(),
  ocr_engine: z.enum(['apple_vision', 'tesseract', 'unavailable']).nullable(),
});
const pdfLocation = {
  document_id: nullableId, title: z.string(), file_path: z.string(), file_name: z.string(),
  page_index: count, page_number: count, margin_note_page_no: count.nullable(),
  mapped_page_no: count.nullable(), page_count: count.nullable(), truncated: z.boolean(),
};
const moveResult = z.object({ note_id: id, from_parent_note_id: nullableId, to_parent_note_id: nullableId, before_note_id: nullableId, title: z.string() });

// Public tasks are distinct from the stable native RPC primitives in rpc-tools.mjs.
export const tools = {
  get_workspace: {
    rpc: 'get_context', description: 'Locate the live MarginNote window, study notebook, PDF and selected card. Use for "what am I viewing/which notebook is open?" Refresh for each live-context question. For card contents call read_card directly; no prior context call is needed. Multiple study windows return AMBIGUOUS_CONTEXT.', schema: z.object({}).strict(),
    outputSchema: z.object({ available: z.boolean(), reason: z.string().nullable(), window_id: nullableId, notebook: z.object({ notebook_id: nullableId, title: z.string() }).nullable(), document: z.object({ document_id: nullableId, title: z.string(), page_count: count.nullable() }).nullable(), focus_note: cardSchema.nullable(), selection_text: z.string(), truncated: z.boolean() }),
  },
  list_notebooks: {
    rpc: 'list_notebooks', description: 'Browse the MarginNote study-set directory to choose a notebook_id. A notebook is a mind-map study set, not a PDF. Follow next_offset until null for the whole directory; use read_card_tree for its cards.', schema: rpc.list_notebooks.schema,
    outputSchema: z.object({ total_count: count, next_offset: count.nullable(), notebooks: z.array(z.object({ notebook_id: id, title: z.string(), document_id: nullableId, root_note_count: count })), truncated: z.boolean() }),
  },
  search_cards: {
    rpc: 'search_notes', description: 'Find cards by indexed text across all MarginNote notebooks or an explicit notebook_id. Returns stable note IDs and text snippets. Handwriting pixels are not searched. At the result limit the list may be incomplete. Use read_card on a returned note_id for full text and images.', schema: rpc.search_notes.schema,
    outputSchema: z.object({ cards: z.array(cardSchema), possibly_truncated: z.boolean(), omitted_without_note_id: count, truncated: z.boolean() }),
  },
  read_card: {
    description: 'Read a complete MarginNote card: text, comments, relationships and available images/handwriting together. Omit note_id for the currently selected card. Default media_source=auto checks card media, linked visual comments and sketch, then focus rendering if needed. Inspect returned images. In code execution, forward image blocks with image(block), not only text(result); otherwise open media[].image_file_path with a local image tool (Codex view_image or Claude Code Read). stroke_count is not a transcription. Continue media pages with returned card.note_id and next_media_offset. include_media=false reads text/structure only.',
    schema: z.object({ note_id: id.optional(), include_media: z.boolean().default(true), media_source: z.enum(['auto', 'note', 'sketch', 'focus_image']).default('auto'), media_offset: count.default(0), media_limit: z.number().int().min(1).max(4).default(3) }).strict().superRefine((v, ctx) => { if (v.media_offset > 0 && !v.note_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Pass note_id when continuing media pagination' }); }),
    outputSchema: z.object({ card: cardSchema, selection_resolved: z.boolean(), media: z.array(mediaSchema), media_total_count: count, next_media_offset: count.nullable(), media_inventory_truncated: z.boolean(), media_status: z.enum(['not_requested', 'none', 'ready', 'partial', 'unavailable']), handwriting_detected: z.boolean(), handwriting_evidence: z.array(z.string()), visual_reading_required: z.boolean(), warnings: z.array(z.string()), truncated: z.boolean() }),
  },
  read_card_tree: {
    rpc: 'get_library_page', description: 'Read a whole notebook card tree or one root_note_id subtree in bounded pages. The first page returns accurate total_count, stable note IDs, parents and order; continue with next_offset and snapshot_id in the same scope. Restart on STALE_SNAPSHOT. Images are not embedded across a whole library; use read_card for cards with visual hints, unknown visual status or truncated text.', schema: rpc.get_library_page.schema,
    outputSchema: z.object({ notebook_id: id, root_note_id: nullableId, snapshot_id: id, total_count: count, next_offset: count.nullable(), cards: z.array(z.object({ note_id: id, parent_note_id: nullableId, order: count, document_id: nullableId, title: z.string(), excerpt: z.string(), content: z.string(), content_truncated: z.boolean(), media_count: count.nullable().default(null), has_visual_content: z.boolean().nullable().default(null), comment_count: count, comments: z.array(comment.extend({ truncated: z.boolean() })), comments_truncated: z.boolean(), summary_link_ids: z.array(nullableId), summary_links_truncated: z.boolean() })), truncated: z.boolean() }),
  },
  read_pdf_page: {
    description: 'Read the currently open MarginNote PDF page in one call: local file location, physical page index, embedded text, OCR status and rendered page image. Open image_file_path if your client does not show the image, especially for handwriting/formulas. include_content=false returns only file location and page numbers. Physical page_number, printed labels and MarginNote numbering can differ. Use read_card for a mind-map card.', schema: z.object({ include_content: z.boolean().default(true) }).strict(),
    outputSchema: z.object({ ...pdfLocation, content_included: z.boolean(), pdf_page_label: z.string().nullable(), embedded_text: z.string(), ocr_text: z.string(), ocr_engine: z.enum(['apple_vision', 'tesseract', 'unavailable', 'not_requested']), ocr_warning: z.string().nullable(), recognized_line_count: count, embedded_text_truncated: z.boolean(), ocr_text_truncated: z.boolean(), image_file_path: z.string().nullable(), image_mime_type: z.enum(['image/png', 'image/jpeg']).nullable(), image_available: z.boolean() }),
  },
  create_cards: {
    rpc: 'create_framework', writes: true, description: 'Create one card or an ordered hierarchy of up to 30 cards in an explicit notebook_id. For one card pass one nodes entry. Each node has a unique key, title and optional Markdown body; parent_key must reference an earlier node. Optional parent_note_id attaches roots under an existing card. Returns created IDs and readback verification. After an unknown timeout inspect before retrying.', schema: rpc.create_framework.schema,
    outputSchema: z.object({ notebook_id: id, all_verified: z.boolean(), cards: z.array(z.object({ key: id, note_id: id, parent_note_id: nullableId, title: z.string(), verified: z.boolean() })), truncated: z.boolean() }),
  },
  append_card_comment: {
    rpc: 'append_comment', writes: true, description: 'Append text or a Markdown comment to an existing card by note_id. Use create_cards to add new cards. Returns the updated card for verification. This writes to MarginNote; inspect after an unknown timeout instead of blindly retrying.', schema: rpc.append_comment.schema,
    outputSchema: z.object({ card: cardSchema, truncated: z.boolean() }),
  },
  promote_excerpt_to_title: {
    rpc: 'promote_excerpt_to_title', writes: true, description: 'Set an existing card title to its current excerpt while preserving the excerpt. This is specifically excerpt-to-title promotion. Supply exact expected_excerpt_text from a recent card read to prevent stale edits. Writes to MarginNote.', schema: rpc.promote_excerpt_to_title.schema,
    outputSchema: z.object({ note_id: id, title: z.string(), excerpt: z.string(), truncated: z.boolean() }),
  },
  preview_card_moves: {
    rpc: 'preview_reorganization', description: 'Validate and preview up to 20 existing card moves/reorders within one notebook before user review. parent_note_id=null moves to root; before_note_id sets sibling placement. Returns snapshot_id and plan_id for apply_card_moves. Does not modify cards. Preview and apply are intentionally separate.', schema: rpc.preview_reorganization.schema,
    outputSchema: z.object({ notebook_id: id, snapshot_id: id, plan_id: id, moves: z.array(moveResult), truncated: z.boolean() }),
  },
  apply_card_moves: {
    rpc: 'apply_reorganization', writes: true, description: 'Apply exactly the moves previously returned by preview_card_moves and reviewed with the user. Supply matching expected_snapshot_id, expected_plan_id and moves. Rejects changed notebooks, cycles and cross-notebook moves; returns readback verification. This writes; inspect an unknown timeout before retrying.', schema: rpc.apply_reorganization.schema,
    outputSchema: z.object({ notebook_id: id, all_verified: z.boolean(), moves: z.array(moveResult.extend({ verified: z.boolean() })), truncated: z.boolean() }),
  },
};
