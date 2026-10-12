import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { nativeArguments, normalize, validate } from '../src/rpc-tools.mjs';

async function nativeFixture() {
  const notebook = { topicId: 'nb', title: 'Study', notes: [] };
  const other = { topicId: 'other', title: 'Other', notes: [] };
  const byId = new Map();
  let sequence = 0;
  function card(title, parent = null, topic = notebook) {
    const note = {
      noteId: `n${++sequence}`, notebookId: topic.topicId, noteTitle: title,
      excerptText: title + ' excerpt', notesText: title + ' content',
      comments: [], childNotes: [], parentNote: null, summaryLinks: [],
      addChild(child) {
        child.removeFromParent();
        const rootIndex = topic.notes.indexOf(child);
        if (rootIndex >= 0) topic.notes.splice(rootIndex, 1);
        this.childNotes.push(child);
        child.parentNote = this;
      },
      insertChildBefore(child, before) {
        const index = this.childNotes.indexOf(before);
        if (index < 0) throw new Error('before missing');
        child.removeFromParent();
        const rootIndex = topic.notes.indexOf(child);
        if (rootIndex >= 0) topic.notes.splice(rootIndex, 1);
        this.childNotes.splice(index, 0, child);
        child.parentNote = this;
      },
      removeFromParent() {
        const siblings = this.parentNote ? this.parentNote.childNotes : topic.notes;
        const index = siblings.indexOf(this);
        if (index >= 0) siblings.splice(index, 1);
        if (this.parentNote) topic.notes.push(this);
        this.parentNote = null;
      },
      appendMarkdownComment(text) { this.comments.push({ type: 'markdown', text }); this.notesText += text; },
    };
    byId.set(note.noteId, note);
    topic.notes.push(note);
    if (parent) parent.addChild(note);
    return note;
  }
  const a = card('A');
  const b = card('B', a);
  const c = card('C', a);
  const d = card('D');
  const outsider = card('Outside', null, other);
  const db = {
    allNotebooks: () => [notebook, other],
    getNoteById: id => byId.get(id),
    getSketchNoteForMindMap: (_topicId, noteId) => byId.get(noteId)?.sketchNote || null,
    getMediaByHash: hash => media.get(hash) || null,
    createNoteWithTitleTopicid: (title, topicId) => card(title, null, topicId === 'nb' ? notebook : other),
    setNotebookSyncDirty() {},
  };
  const media = new Map();
  const documentController = { focusNote: a, imageFromFocusNote: () => null };
  const context = vm.createContext({
    Database: { sharedInstance: () => db },
    Application: { sharedInstance: () => ({ refreshAfterDBChanged() {}, studyController: () => ({ readerController: { currentDocumentController: documentController } }) }) },
    UndoManager: { sharedInstance: () => ({ undoGrouping(_label, _topic, callback) { callback(); } }) },
  });
  vm.runInContext(await readFile(new URL('../../addon/tools.js', import.meta.url), 'utf8'), context);
  return { execute: (tool, args) => context.MNAgentTools.execute({ window: {} }, tool, args), card, media, documentController, a, b, c, d, outsider, notebook };
}

test('card media exposes raster images and identifies non-image data', async () => {
  const f = await nativeFixture();
  const pngHash = 'a'.repeat(32);
  const strokeHash = 'b'.repeat(32);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
  const strokes = Buffer.from('wrd\xf0stroke data', 'latin1');
  f.a.mediaList = `${pngHash}-${strokeHash}-`;
  f.a.getStrokesCount = () => 2;
  f.media.set(pngHash, { length: png.length, base64Encoding: () => png.toString('base64') });
  f.media.set(strokeHash, { length: strokes.length, base64Encoding: () => strokes.toString('base64') });
  const args = validate('get_note_media', { note_id: f.a.noteId });
  assert.deepEqual(nativeArguments('get_note_media', args), { noteId: f.a.noteId, source: 'note', mediaIndex: 0 });
  const image = normalize('get_note_media', f.execute('get_note_media', nativeArguments('get_note_media', args)), args);
  assert.equal(image.image_mime_type, 'image/png');
  assert.equal(image.media_count, 2);
  assert.equal(image.stroke_count, 2);
  assert.equal(image.media_hash, pngHash);
  f.a.comments = [{ type: 'PaintNote', noteId: 'linked-comment' }];
  const card = normalize('get_note', f.execute('get_note', { noteId: f.a.noteId }), { note_id: f.a.noteId }).note;
  assert.equal(card.media_count, 2);
  assert.equal(card.stroke_count, 2);
  assert.equal(card.comments[0].note_id, 'linked-comment');
  const treeCard = f.execute('get_library_page', { topicId: 'nb', limit: 1 }).cards[0];
  assert.equal(treeCard.hasVisualContent, true);
  assert.equal(treeCard.mediaCount, 2);
  const strokeArgs = validate('get_note_media', { note_id: f.a.noteId, media_index: 1 });
  const vector = normalize('get_note_media', f.execute('get_note_media', nativeArguments('get_note_media', strokeArgs)), strokeArgs);
  assert.equal(vector.media_format, 'wrd_binary');
  assert.equal(vector.image_base64, null);
  f.a.sketchNote = { noteId: 'sketch1', mediaList: `${pngHash}-`, getStrokesCount: () => 1 };
  const sketchArgs = validate('get_note_media', { note_id: f.a.noteId, source: 'sketch' });
  assert.equal(normalize('get_note_media', f.execute('get_note_media', nativeArguments('get_note_media', sketchArgs)), sketchArgs).media_note_id, 'sketch1');
  f.documentController.imageFromFocusNote = () => ({ length: png.length, base64Encoding: () => png.toString('base64') });
  const focusArgs = validate('get_note_media', { note_id: f.a.noteId, source: 'focus_image' });
  assert.equal(normalize('get_note_media', f.execute('get_note_media', nativeArguments('get_note_media', focusArgs)), focusArgs).image_mime_type, 'image/png');
  assert.throws(() => f.execute('get_note_media', { noteId: f.b.noteId, source: 'focus_image', mediaIndex: 0 }), { code: 'MEDIA_UNAVAILABLE' });
});

test('notebook and card pagination preserve relationships and reject stale snapshots', async () => {
  const f = await nativeFixture();
  const books = f.execute('list_notebooks', { offset: 0, limit: 1 });
  assert.equal(books.totalCount, 2);
  assert.equal(books.nextOffset, 1);
  const first = f.execute('get_library_page', { topicId: 'nb', offset: 0, limit: 2 });
  const second = f.execute('get_library_page', { topicId: 'nb', offset: 2, limit: 2, snapshotId: first.snapshotId });
  assert.equal(first.totalCount, 4);
  assert.deepEqual([...first.cards, ...second.cards].map(c => c.noteId), [f.a.noteId, f.b.noteId, f.c.noteId, f.d.noteId]);
  assert.equal(first.cards[1].parentNoteId, f.a.noteId);
  assert.equal(second.nextOffset, null);
  const subtree = f.execute('get_library_page', { topicId: 'nb', rootNoteId: f.a.noteId, offset: 0, limit: 2 });
  assert.equal(subtree.totalCount, 3);
  assert.deepEqual(Array.from(subtree.cards, c => c.noteId), [f.a.noteId, f.b.noteId]);
  assert.equal(subtree.nextOffset, 2);
  assert.deepEqual(Array.from(f.execute('get_library_page', { topicId: 'nb', rootNoteId: f.a.noteId, offset: 2, limit: 2, snapshotId: subtree.snapshotId }).cards, c => c.noteId), [f.c.noteId]);
  assert.throws(() => f.execute('get_library_page', { topicId: 'nb', rootNoteId: f.outsider.noteId }), { code: 'NOTE_NOT_FOUND' });
  f.c.noteTitle = 'changed';
  assert.throws(() => f.execute('get_library_page', { topicId: 'nb', offset: 2, snapshotId: first.snapshotId }), { code: 'STALE_SNAPSHOT' });
});

test('conversation outline creates a hierarchy, verifies it and promotes excerpt text', async () => {
  const f = await nativeFixture();
  const single = f.execute('create_card', { topicId: 'nb', title: 'Added', parentNoteId: f.d.noteId, comment: 'first', commentFormat: 'markdown' });
  assert.equal(single.parentNoteId, f.d.noteId);
  const appended = f.execute('append_comment', { noteId: single.noteId, text: 'second', format: 'markdown' });
  assert.equal(appended.comments.length, 2);
  assert.throws(() => f.execute('create_card', { topicId: 'nb', title: 'Wrong', parentNoteId: f.outsider.noteId }), { code: 'INVALID_ARGUMENT' });
  const result = f.execute('create_framework', { topicId: 'nb', parentNoteId: f.d.noteId, nodes: [
    { key: 'root', title: 'Framework', body: 'From chat' },
    { key: 'child', parentKey: 'root', title: 'Concept' },
  ] });
  assert.equal(result.allVerified, true);
  assert.equal(result.cards[0].parentNoteId, f.d.noteId);
  assert.equal(result.cards[1].parentNoteId, result.cards[0].noteId);
  assert.equal(f.notebook.notes.length, 2);
  const promoted = f.execute('promote_excerpt_to_title', { noteId: f.b.noteId, expectedExcerptText: 'B excerpt' });
  assert.equal(promoted.title, 'B excerpt');
  assert.equal(promoted.excerptText, 'B excerpt');
  assert.throws(() => f.execute('promote_excerpt_to_title', { noteId: f.b.noteId, expectedExcerptText: 'old' }), { code: 'STALE_SNAPSHOT' });
});

test('reorganization requires matching preview, rejects cycles and verifies moved cards', async () => {
  const f = await nativeFixture();
  const moves = [{ noteId: f.c.noteId, parentNoteId: f.d.noteId }];
  const preview = f.execute('preview_reorganization', { topicId: 'nb', moves });
  assert.equal(f.c.parentNote.noteId, f.a.noteId);
  assert.throws(() => f.execute('apply_reorganization', { topicId: 'nb', expectedSnapshotId: preview.snapshotId, expectedPlanId: preview.planId, moves: [{ noteId: f.b.noteId, parentNoteId: f.d.noteId }] }), { code: 'INVALID_ARGUMENT' });
  const applied = f.execute('apply_reorganization', { topicId: 'nb', expectedSnapshotId: preview.snapshotId, expectedPlanId: preview.planId, moves });
  assert.equal(applied.allVerified, true);
  assert.equal(f.c.parentNote.noteId, f.d.noteId);
  const reorder = [{ noteId: f.c.noteId, parentNoteId: f.a.noteId, beforeNoteId: f.b.noteId }];
  const preview2 = f.execute('preview_reorganization', { topicId: 'nb', moves: reorder });
  const applied2 = f.execute('apply_reorganization', { topicId: 'nb', expectedSnapshotId: preview2.snapshotId, expectedPlanId: preview2.planId, moves: reorder });
  assert.equal(applied2.allVerified, true);
  assert.deepEqual(f.a.childNotes.map(n => n.noteId), [f.c.noteId, f.b.noteId]);
  const rootMove = [{ noteId: f.c.noteId, parentNoteId: null }];
  const rootPreview = f.execute('preview_reorganization', { topicId: 'nb', moves: rootMove });
  const rootApplied = f.execute('apply_reorganization', { topicId: 'nb', expectedSnapshotId: rootPreview.snapshotId, expectedPlanId: rootPreview.planId, moves: rootMove });
  assert.equal(rootApplied.allVerified, true);
  assert.equal(f.c.parentNote, null);
  const stale = f.execute('preview_reorganization', { topicId: 'nb', moves });
  f.b.noteTitle = 'changed';
  assert.throws(() => f.execute('apply_reorganization', { topicId: 'nb', expectedSnapshotId: stale.snapshotId, expectedPlanId: stale.planId, moves }), { code: 'STALE_SNAPSHOT' });
  assert.throws(() => f.execute('preview_reorganization', { topicId: 'nb', moves: [{ noteId: f.a.noteId, parentNoteId: f.b.noteId }] }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => f.execute('preview_reorganization', { topicId: 'nb', moves: [{ noteId: f.a.noteId, parentNoteId: f.outsider.noteId }] }), { code: 'INVALID_ARGUMENT' });
});

test('MCP contracts map bounded library reads and mark writes as non-idempotent', () => {
  const args = validate('get_library_page', { notebook_id: 'nb', limit: 2 });
  assert.deepEqual(nativeArguments('get_library_page', args), { topicId: 'nb', offset: 0, limit: 2 });
  const subtreeArgs = validate('get_library_page', { notebook_id: 'nb', root_note_id: 'n1' });
  assert.deepEqual(nativeArguments('get_library_page', subtreeArgs), { topicId: 'nb', offset: 0, limit: 30, rootNoteId: 'n1' });
  const page = normalize('get_library_page', { topicId: 'nb', snapshotId: '4-ab', totalCount: 4, nextOffset: 2, cards: [{ noteId: 'n1', parentNoteId: '', order: 0, title: 'A' }] }, args);
  assert.equal(page.cards[0].note_id, 'n1');
  assert.equal(page.snapshot_id, '4-ab');
  assert.throws(() => validate('create_framework', { notebook_id: 'nb', nodes: [] }), { code: 'INVALID_ARGUMENT' });
});
