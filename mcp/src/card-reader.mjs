import { cardSchema } from './tools.mjs';
import { BridgeError } from './errors.mjs';
import { localImagePath, renderedNoteImage } from './note-media.mjs';

const visualComment = /paint|sketch|handwrit|image|picture/i;
const expectedMissing = new Set(['MEDIA_UNAVAILABLE', 'NOTE_NOT_FOUND']);

export async function readCard(client, args, { render = renderedNoteImage, save = localImagePath } = {}) {
  let noteId = args.note_id;
  if (!noteId) {
    noteId = (await client.call('get_context', {})).focus_note?.note_id;
    if (!noteId) throw new BridgeError('NO_ACTIVE_CONTEXT', 'Select a card in MarginNote, or supply note_id');
  }
  const raw = await client.call('get_note', { note_id: noteId });
  if (raw.note?.note_id !== noteId) throw new BridgeError('RPC_FAILURE', 'Card ID changed during reading');
  const card = cardSchema.parse(raw.note);
  const evidence = [];
  const warnings = [];
  if (card.stroke_count > 0) evidence.push(`card_strokes:${card.stroke_count}`);
  if (card.comments.some(c => /paint|sketch|handwrit/i.test(c.type))) evidence.push('handwritten_comment');
  const output = { card, selection_resolved: !args.note_id, media: [], media_total_count: 0,
    next_media_offset: null, media_inventory_truncated: false, media_status: 'not_requested',
    handwriting_detected: evidence.length > 0, handwriting_evidence: evidence,
    visual_reading_required: evidence.length > 0 || card.media_count > 0 || card.comments.some(c => visualComment.test(c.type)), warnings, truncated: Boolean(raw.truncated) };
  if (!args.include_media) return { output, images: [] };

  const sources = [];
  const auto = args.media_source === 'auto';
  const related = card.comments.filter(c => c.note_id && visualComment.test(c.type));
  if (auto) {
    sources.push({ note_id: noteId, source: 'note' });
    for (const c of related.slice(0, 4)) {
      if (!sources.some(s => s.note_id === c.note_id)) sources.push({ note_id: c.note_id, source: 'note' });
    }
    if (related.length > 4) {
      output.media_inventory_truncated = true;
      warnings.push('Only the first four linked visual comments were inspected; read remaining comment note_ids directly.');
    }
    sources.push({ note_id: noteId, source: 'sketch' });
  } else sources.push({ note_id: noteId, source: args.media_source });

  const inventory = [];
  const seenNotes = new Set();
  const addSource = async (source) => {
    let first;
    try { first = await client.call('get_note_media', { ...source, media_index: 0 }); }
    catch (error) {
      if (!expectedMissing.has(error.code) || (source.source === 'note' && source.note_id === noteId)) throw error;
      if (!auto || source.note_id !== noteId) warnings.push(`${source.source}:${source.note_id}:${error.code}`);
      return;
    }
    const key = `${first.media_note_id || source.note_id}:${source.source === 'focus_image' ? 'focus' : 'media'}`;
    if (seenNotes.has(key)) return;
    seenNotes.add(key);
    if (first.stroke_count > 0) evidence.push(`${source.source}:${source.note_id}:strokes:${first.stroke_count}`);
    const count = first.media_count || 0;
    if (!count) {
      if (first.stroke_count > 0 || first.excerpt_picture_available) inventory.push({ source, index: null, first });
      return;
    }
    const bounded = Math.min(count, 101); // Compatible with the existing Host's media-index bound.
    if (count > bounded) {
      output.media_inventory_truncated = true;
      warnings.push(`${source.source}:${source.note_id}: only the first 101 media items can be read.`);
    }
    first = await render(first);
    for (let index = 0; index < bounded; index++) inventory.push({ source, index, first: index === 0 ? first : null });
  };
  for (const source of sources) await addSource(source);
  // A focused PDF excerpt may be renderable even when its original media has no usable cache.
  if (auto && !inventory.some(x => x.first?.image_base64)) await addSource({ note_id: noteId, source: 'focus_image' });
  output.media_total_count = inventory.length;
  if (args.media_offset > inventory.length) throw new BridgeError('INVALID_ARGUMENT', 'media_offset is outside this card media inventory');
  const entries = inventory.slice(args.media_offset, args.media_offset + args.media_limit);
  const images = [];
  for (const entry of entries) {
    const media = await render(entry.first || await client.call('get_note_media', { ...entry.source, media_index: entry.index }));
    const imagePath = media.image_base64 ? await save(media) : null;
    const imageReady = Boolean(media.image_base64 && imagePath);
    output.media.push({ source: entry.source.source, requested_note_id: entry.source.note_id,
      media_note_id: media.media_note_id || null, media_index: entry.index,
      media_hash: media.media_hash || null, media_format: media.media_format || null,
      stroke_count: media.stroke_count ?? null, byte_count: media.byte_count ?? null,
      status: imageReady ? 'image' : 'unrenderable', reason: imageReady ? null : (media.image_unavailable_reason || media.reason || 'RENDER_UNAVAILABLE'),
      image_source: imageReady ? (media.image_source || 'native_media') : null,
      image_mime_type: imageReady ? media.image_mime_type : null, image_file_path: imagePath,
      image_byte_count: imageReady ? Buffer.from(media.image_base64, 'base64').length : null,
      ocr_text: media.ocr_text ?? null,
      ocr_engine: media.ocr_engine ?? null,
    });
    if (imageReady) images.push({ type: 'image', data: media.image_base64, mimeType: media.image_mime_type });
  }
  const next = args.media_offset + entries.length;
  output.next_media_offset = next < inventory.length ? next : null;
  output.handwriting_detected = evidence.length > 0;
  output.visual_reading_required ||= output.handwriting_detected || images.length > 0;
  output.media_status = !inventory.length ? (output.handwriting_detected ? 'unavailable' : 'none') : !images.length ? 'unavailable' :
    (images.length < entries.length || output.next_media_offset !== null || output.media_inventory_truncated || warnings.length) ? 'partial' : 'ready';
  if (output.handwriting_detected && !images.length) warnings.push('Handwriting evidence exists but this response has no rendered image. Empty text is not a blank card.');
  return { output, images };
}
