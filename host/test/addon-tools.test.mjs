import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

async function loadTools({ document, documentController, selectedViews, focusNote = null }) {
  const notebookController = {
    notebookId: "topic-1",
    focusNote,
    mindmapView: { selViewLst: selectedViews },
  };
  const study = {
    notebookController,
    readerController: { currentDocumentController: documentController },
  };
  documentController.document = document;
  class NSNull {}
  const context = vm.createContext({
    NSNull,
    Application: {
      sharedInstance: () => ({ studyController: () => study }),
    },
    Database: {
      sharedInstance: () => ({
        getNotebookById: () => ({ topicId: "topic-1", title: "算法" }),
      }),
    },
  });
  vm.runInContext(await readFile(new URL("../../addon/tools.js", import.meta.url), "utf8"), context);
  return context.MNAgentTools;
}

test("addon reads PDF selection and selected mind-map notes", async () => {
  const note = {
    noteId: "note-1",
    notebookId: "topic-1",
    docMd5: "doc-1",
    noteTitle: "选中的卡片",
    excerptText: "摘录",
    notesText: "笔记正文",
    comments: [{ type: "text", text: "评论" }],
  };
  const tools = await loadTools({
    document: { docMd5: "doc-1", docTitle: "测试 PDF", pageCount: 3 },
    documentController: { currentPage: 1, selectionText: "PDF 选区" },
    selectedViews: [{ note: { note } }],
  });

  const result = tools.execute({ window: {} }, "get_selection", {});
  assert.equal(result.pdfSelection.text, "PDF 选区");
  assert.equal(result.selectedNotes.selectedCount, 1);
  assert.equal(result.selectedNotes.notes[0].title, "选中的卡片");
  assert.equal(result.selectedNotes.notes[0].comments[0].text, "评论");
});

test("addon reads current PDF pages and returns a continuation cursor", async () => {
  const pageText = "x".repeat(1500);
  const tools = await loadTools({
    document: {
      docMd5: "doc-1",
      docTitle: "测试 PDF",
      pageCount: 3,
      textContentsForPageNo: (page) => (page === 1 ? [pageText] : [`page-${page}`]),
    },
    documentController: { currPageIndex: 1, pageNoFromIndex: index => index + 1, selectionText: "" },
    selectedViews: [],
  });

  const result = tools.execute({ window: {} }, "read_pdf", {
    startPage: 1,
    endPage: 3,
    maxChars: 1000,
  });
  assert.equal(result.pages[0].page, 1);
  assert.equal(result.document.currentPage, 2);
  assert.equal(result.pages[0].text.length, 1000);
  assert.equal(result.nextCursor.page, 1);
  assert.equal(result.nextCursor.charOffset, 1000);
  assert.equal(result.truncated, true);
  assert.equal(result.pages[0].textAvailable, true);
  const continued = tools.execute({ window: {} }, "read_pdf", { startPage: result.nextCursor.page, startChar: result.nextCursor.charOffset, endPage: 2, maxChars: 1000 });
  assert.equal(continued.pages[0].text.length, 500);
  assert.equal(continued.pages[1].page, 2);
  assert.equal(continued.pages[1].text, "page-2");
  assert.throws(() => tools.execute({ window: {} }, "read_pdf", { documentId: "other" }), /does not match/);
});

test("addon returns only the open PDF location and current page index", async () => {
  const tools = await loadTools({
    document: { docMd5: "doc-1", docTitle: "测试 PDF", fullPathFileName: "/tmp/测试 PDF.pdf", pageCount: 3 },
    documentController: { currPageIndex: 2, currPageNo: 7, pageNoFromIndex: () => 8 },
    selectedViews: [],
  });
  const result = tools.execute({ window: {} }, "get_current_pdf", {});
  assert.equal(result.filePath, "/tmp/测试 PDF.pdf");
  assert.equal(result.pageIndex, 2);
  assert.equal(result.marginNotePageNo, 7);
  assert.equal(result.mappedPageNo, 8);
  assert.equal(result.pageCount, 3);
  assert.equal(result.pages, undefined);
  assert.equal(result.text, undefined);
});

test("PDF locator reports an unavailable path or page without guessing", async () => {
  const tools = await loadTools({
    document: { docMd5: "doc-1", docTitle: "PDF", pageCount: 3 },
    documentController: { currPageIndex: 0 },
    selectedViews: [],
  });
  assert.throws(() => tools.execute({ window: {} }, "get_current_pdf", {}), /path is unavailable/);
});
