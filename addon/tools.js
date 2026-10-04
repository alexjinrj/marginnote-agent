var MNAgentTools = (function () {
  function isNil(value) {
    if (value === null || typeof value === "undefined") return true;
    try {
      return typeof NSNull !== "undefined" && value instanceof NSNull;
    } catch (error) {
      return false;
    }
  }

  function stringValue(value, fallback) {
    if (isNil(value)) return fallback || "";
    try {
      return String(value);
    } catch (error) {
      return fallback || "";
    }
  }

  function numberValue(value) {
    if (typeof value === "number") return value;
    if (isNil(value)) return null;
    try {
      if (typeof value.integerValue === "function") return value.integerValue();
      if (typeof value.doubleValue === "function") return value.doubleValue();
      var converted = Number(value);
      return isNaN(converted) ? null : converted;
    } catch (error) {
      return null;
    }
  }

  function propertyValue(target, name) {
    if (isNil(target)) return null;
    try {
      var value = target[name];
      return typeof value === "function" ? value.call(target) : value;
    } catch (error) {
      return null;
    }
  }

  function arrayValue(value) {
    if (isNil(value)) return [];
    if (Array.isArray(value)) return value;
    var output = [];
    try {
      var count = typeof value.count === "function" ? value.count() : value.length;
      for (var index = 0; index < count; index += 1) {
        if (typeof value.objectAtIndex === "function") output.push(value.objectAtIndex(index));
        else output.push(value[index]);
      }
    } catch (error) {}
    return output;
  }

  function studyController(addon) {
    var app = Application.sharedInstance();
    return app && addon.window ? app.studyController(addon.window) : null;
  }

  function currentTopicId(addon) {
    var study = studyController(addon);
    var notebookController = study && study.notebookController;
    return notebookController ? stringValue(notebookController.notebookId) : "";
  }

  function serializeComment(comment) {
    if (isNil(comment)) return null;
    return {
      type: stringValue(comment.type || comment.commentType),
      text: stringValue(comment.text || comment.noteText || comment.html),
      noteId: stringValue(comment.noteId || comment.noteid),
    };
  }

  function serializeNote(note, includeChildren) {
    if (isNil(note)) return null;
    var comments = arrayValue(note.comments).map(serializeComment).filter(function (item) {
      return item !== null;
    });
    var children = arrayValue(note.childNotes).map(function (child) {
      if (includeChildren) return serializeNote(child, false);
      return {
        noteId: stringValue(child.noteId),
        title: stringValue(child.noteTitle),
      };
    });
    return {
      noteId: stringValue(note.noteId),
      notebookId: stringValue(note.notebookId),
      docMd5: stringValue(note.docMd5),
      title: stringValue(note.noteTitle),
      excerptText: stringValue(note.excerptText),
      notesText: stringValue(note.notesText),
      colorIndex: numberValue(note.colorIndex),
      startPage: numberValue(note.startPage),
      endPage: numberValue(note.endPage),
      comments: comments,
      children: children,
      parentNoteId: !isNil(note.parentNote) ? stringValue(note.parentNote.noteId) : "",
    };
  }

  function serializeNoteSafely(note, includeChildren) {
    if (isNil(note)) return null;
    try {
      return serializeNote(note, includeChildren);
    } catch (error) {
      return {
        noteId: stringValue(note.noteId),
        notebookId: stringValue(note.notebookId),
        docMd5: stringValue(note.docMd5),
        title: stringValue(note.noteTitle),
        excerptText: stringValue(note.excerptText),
        notesText: stringValue(note.notesText),
        comments: [],
        children: [],
        parentNoteId: "",
        truncated: true,
      };
    }
  }

  function normalizeSearchItem(item) {
    if (isNil(item)) return null;
    if (item.note) item = item.note;
    if (item.noteId || item.noteTitle || item.excerptText) return serializeNote(item, false);
    return {
      noteId: stringValue(item.noteId || item.noteid || item.id),
      title: stringValue(item.title || item.noteTitle),
      text: stringValue(item.text || item.excerptText || item.snippet),
      topicId: stringValue(item.topicId || item.topicid),
      docMd5: stringValue(item.docMd5 || item.docmd5),
      page: numberValue(item.page || item.pageNo),
      rowId: numberValue(item.rowid || item.rowId),
    };
  }

  function refresh(topicId) {
    Database.sharedInstance().setNotebookSyncDirty(topicId);
    Application.sharedInstance().refreshAfterDBChanged(topicId);
  }

  function getContext(addon) {
    var study = studyController(addon);
    if (!study) return { available: false, reason: "No active study window" };
    var notebookController = study.notebookController;
    var readerController = study.readerController;
    var documentController = readerController && readerController.currentDocumentController;
    var document = documentController && documentController.document;
    var topicId = notebookController ? stringValue(notebookController.notebookId) : "";
    var notebook = topicId ? Database.sharedInstance().getNotebookById(topicId) : null;
    return {
      available: true,
      notebook: notebook
        ? { topicId: stringValue(notebook.topicId), title: stringValue(notebook.title) }
        : { topicId: topicId, title: "" },
      document: document
        ? {
            docMd5: stringValue(document.docMd5),
            title: stringValue(document.docTitle),
            pageCount: numberValue(propertyValue(document, "pageCount")),
          }
        : null,
      focusNote: notebookController ? serializeNoteSafely(notebookController.focusNote, false) : null,
      selectionText: documentController ? stringValue(documentController.selectionText) : "",
    };
  }

  function takeText(value, state) {
    var text = stringValue(value);
    if (!text || state.remaining <= 0) {
      if (text) state.truncated = true;
      return "";
    }
    if (text.length <= state.remaining) {
      state.remaining -= text.length;
      return text;
    }
    var output = text.slice(0, state.remaining);
    state.remaining = 0;
    state.truncated = true;
    return output;
  }

  function serializeSelectedNote(note, budget) {
    var state = { remaining: budget, truncated: false };
    var comments = [];
    var rawComments = arrayValue(note.comments);
    for (var index = 0; index < rawComments.length && state.remaining > 0; index += 1) {
      var comment = rawComments[index];
      if (isNil(comment)) continue;
      comments.push({
        type: stringValue(comment.type || comment.commentType),
        text: takeText(comment.text || comment.noteText || comment.html, state),
        noteId: stringValue(comment.noteId || comment.noteid),
      });
    }
    if (comments.length < rawComments.length) state.truncated = true;
    return {
      noteId: stringValue(note.noteId),
      notebookId: stringValue(note.notebookId),
      docMd5: stringValue(note.docMd5),
      title: stringValue(note.noteTitle),
      excerptText: takeText(note.excerptText, state),
      notesText: takeText(note.notesText, state),
      startPage: numberValue(note.startPage),
      endPage: numberValue(note.endPage),
      comments: comments,
      truncated: state.truncated,
    };
  }

  function selectedMindMapNotes(addon, args) {
    var study = studyController(addon);
    var notebookController = study && study.notebookController;
    var mindmapView = notebookController && notebookController.mindmapView;
    var selectedViews = arrayValue(mindmapView && mindmapView.selViewLst);
    var limit = Math.max(1, Math.min(Number(args.limit || 20), 50));
    var maxChars = Math.max(1000, Math.min(Number(args.maxChars || 20000), 50000));
    var budget = Math.max(500, Math.floor(maxChars / Math.max(1, Math.min(limit, selectedViews.length))));
    var notes = [];
    var seen = Object.create(null);
    for (var index = 0; index < selectedViews.length && notes.length < limit; index += 1) {
      var wrapper = selectedViews[index] && selectedViews[index].note;
      var note = wrapper && wrapper.note ? wrapper.note : wrapper;
      if (isNil(note)) continue;
      var noteId = stringValue(note.noteId);
      if (!noteId || seen[noteId]) continue;
      seen[noteId] = true;
      notes.push(serializeSelectedNote(note, budget));
    }
    return {
      selectedCount: selectedViews.length,
      returnedCount: notes.length,
      truncated: notes.length < selectedViews.length || notes.some(function (note) {
        return note.truncated;
      }),
      notes: notes,
    };
  }

  function getSelection(addon, args) {
    var context;
    try {
      context = getContext(addon);
    } catch (error) {
      context = { available: false, document: null, selectionText: "" };
    }
    var selectedNotes = selectedMindMapNotes(addon, args);
    return {
      available: context.available,
      document: context.document,
      selectionText: context.selectionText || "",
      pdfSelection: { text: context.selectionText || "" },
      selectedNotes: selectedNotes,
    };
  }

  function invokePageText(target, methodName, pageIndex) {
    if (isNil(target)) return { supported: false, text: "" };
    try {
      var method = target[methodName];
      if (typeof method !== "function") return { supported: false, text: "" };
      var content = method.call(target, pageIndex);
      if (typeof content === "string") return { supported: true, text: content };
      var lines = arrayValue(content);
      if (Array.isArray(content) || (content && typeof content.count === "function")) {
        return { supported: true, text: lines.map(function (part) { return stringValue(part); }).join("\n") };
      }
      return { supported: true, text: stringValue(content) };
    } catch (error) {
      return { supported: false, text: "" };
    }
  }

  function pageText(documentController, document, pageIndex, currentPageIndex) {
    if (pageIndex === currentPageIndex && documentController) {
      try {
        if (typeof documentController.getCurrentPageText === "function") {
          return {
            supported: true,
            text: stringValue(documentController.getCurrentPageText()),
          };
        }
      } catch (error) {}
    }
    var pageNo = pageIndex + 1;
    try {
      if (documentController && typeof documentController.pageNoFromIndex === "function") {
        pageNo = documentController.pageNoFromIndex(pageIndex);
      }
    } catch (error) {}
    var candidates = [
      [document, "textContentsForPageNo", pageNo],
      [document, "textContentsForPageNo2", pageNo],
      [document, "textForPageNo", pageNo],
      [documentController, "textContentsForPageNo", pageNo],
      [documentController, "textContentsForPageNo2", pageNo],
      [documentController, "textForPageNo", pageNo],
    ];
    for (var index = 0; index < candidates.length; index += 1) {
      var result = invokePageText(candidates[index][0], candidates[index][1], candidates[index][2]);
      if (result.supported) return result;
    }
    return { supported: false, text: "" };
  }

  function currentPageIndex(documentController) {
    var names = ["currPageIndex", "currentPage", "pageIndex"];
    for (var index = 0; index < names.length; index += 1) {
      var value = numberValue(propertyValue(documentController, names[index]));
      if (value !== null && value >= 0) return Math.floor(value);
    }
    return 0;
  }

  function getCurrentPdf(addon) {
    var study = studyController(addon);
    if (!study) {
      var noStudy = new Error("No active study window");
      noStudy.code = "NO_ACTIVE_CONTEXT";
      throw noStudy;
    }
    var readerController = study.readerController;
    var documentController = readerController && readerController.currentDocumentController;
    var document = documentController && documentController.document;
    if (!documentController || !document) {
      var noPdf = new Error("No active PDF document");
      noPdf.code = "NO_ACTIVE_CONTEXT";
      throw noPdf;
    }
    var filePath = stringValue(propertyValue(document, "fullPathFileName"));
    if (!filePath || (filePath.charAt(0) !== "/" && filePath.indexOf("file://") !== 0)) {
      var fallbackPath = stringValue(propertyValue(document, "pathFile"));
      if (fallbackPath) filePath = fallbackPath;
    }
    if (!filePath) {
      var missingPath = new Error("Current PDF file path is unavailable");
      missingPath.code = "PDF_PATH_UNAVAILABLE";
      throw missingPath;
    }
    var pageIndex = numberValue(propertyValue(documentController, "currPageIndex"));
    if (pageIndex === null || pageIndex < 0 || Math.floor(pageIndex) !== pageIndex) {
      var missingPage = new Error("Current PDF page index is unavailable");
      missingPage.code = "PDF_PAGE_UNAVAILABLE";
      throw missingPage;
    }
    return {
      docMd5: stringValue(propertyValue(document, "docMd5")),
      title: stringValue(propertyValue(document, "docTitle")),
      filePath: filePath,
      pageIndex: pageIndex,
      pageCount: numberValue(propertyValue(document, "pageCount")),
    };
  }

  function readPdf(addon, args) {
    var study = studyController(addon);
    if (!study) throw new Error("No active study window");
    var readerController = study.readerController;
    var documentController = readerController && readerController.currentDocumentController;
    var document = documentController && documentController.document;
    if (!documentController || !document) throw new Error("No active PDF document");
    var docMd5 = stringValue(document.docMd5);
    if (args.documentId && docMd5 !== args.documentId) {
      var mismatch = new Error("Open PDF does not match document_id");
      mismatch.code = "INVALID_ARGUMENT";
      throw mismatch;
    }

    var pageCount = numberValue(propertyValue(document, "pageCount"));
    var currentIndex = currentPageIndex(documentController);
    var startPage = Math.floor(Number(args.startPage || currentIndex + 1));
    var endPage = Math.floor(Number(args.endPage || startPage));
    var startChar = Math.max(0, Math.floor(Number(args.startChar || 0)));
    var maxChars = Math.max(1000, Math.min(Number(args.maxChars || 20000), 50000));
    if (startPage < 1 || endPage < startPage || endPage > startPage + 19) throw new Error("Invalid PDF page range");
    if (pageCount !== null && startPage > pageCount) throw new Error("PDF startPage exceeds pageCount");
    if (pageCount !== null) endPage = Math.min(endPage, pageCount);

    var lastPage = endPage;
    var pages = [];
    var remaining = maxChars;
    var nextCursor = null;
    var supported = false;
    for (var page = startPage; page <= lastPage; page += 1) {
      var extracted = pageText(documentController, document, page - 1, currentIndex);
      supported = supported || extracted.supported;
      var offset = page === startPage ? startChar : 0;
      var available = extracted.text.slice(offset);
      var length = Math.min(available.length, remaining);
      pages.push({
        page: page,
        startChar: offset,
        text: available.slice(0, length),
        complete: length === available.length,
        textAvailable: extracted.supported && extracted.text.length > 0,
      });
      remaining -= length;
      if (length < available.length) {
        nextCursor = { page: page, charOffset: offset + length };
        break;
      }
      if (remaining <= 0 && page < endPage) {
        nextCursor = { page: page + 1, charOffset: 0 };
        break;
      }
    }
    if (!supported) throw new Error("Current MarginNote document does not expose page text");
    if (!nextCursor && lastPage < endPage) nextCursor = { page: lastPage + 1, charOffset: 0 };

    return {
      available: true,
      document: {
        docMd5: docMd5,
        title: stringValue(document.docTitle),
        pageCount: pageCount,
        currentPage: currentIndex + 1,
      },
      range: { startPage: startPage, endPage: endPage },
      pages: pages,
      truncated: Boolean(nextCursor),
      nextCursor: nextCursor,
    };
  }

  function listNotebooks(args) {
    var limit = Math.max(1, Math.min(Number(args.limit || 50), 100));
    var offset = Math.max(0, Math.floor(Number(args.offset || 0)));
    var all = arrayValue(Database.sharedInstance().allNotebooks());
    return {
      totalCount: all.length,
      nextOffset: offset + limit < all.length ? offset + limit : null,
      notebooks: all.slice(offset, offset + limit)
      .map(function (notebook) {
        return {
          topicId: stringValue(notebook.topicId),
          title: stringValue(notebook.title),
          mainDocMd5: stringValue(notebook.mainDocMd5),
          rootNoteCount: arrayValue(notebook.notes).filter(function (note) { return isNil(note.parentNote); }).length,
        };
      }),
    };
  }

  function fail(code, message) {
    var error = new Error(message);
    error.code = code;
    throw error;
  }

  function notebookById(topicId) {
    var notebooks = arrayValue(Database.sharedInstance().allNotebooks());
    for (var i = 0; i < notebooks.length; i += 1) {
      if (stringValue(notebooks[i].topicId) === topicId) return notebooks[i];
    }
    fail("NOTEBOOK_NOT_FOUND", "Notebook not found: " + topicId);
  }

  function notebookCards(topicId) {
    var roots = arrayValue(notebookById(topicId).notes);
    var cards = [];
    var seen = Object.create(null);
    function visit(note, parentId, order) {
      if (isNil(note)) return;
      var noteId = stringValue(note.noteId);
      if (!noteId || seen[noteId]) return;
      seen[noteId] = true;
      cards.push({ note: note, noteId: noteId, parentId: parentId, order: order });
      var children = arrayValue(note.childNotes);
      for (var i = 0; i < children.length; i += 1) visit(children[i], noteId, i);
    }
    var rootOrder = 0;
    for (var i = 0; i < roots.length; i += 1) {
      var root = roots[i];
      var parent = root && root.parentNote;
      if (!isNil(parent) && stringValue(parent.notebookId) === topicId) continue;
      visit(root, isNil(parent) ? "" : stringValue(parent.noteId), rootOrder++);
    }
    for (var j = 0; j < roots.length; j += 1) {
      var stray = roots[j];
      if (!isNil(stray) && !seen[stringValue(stray.noteId)]) {
        var strayParent = stray.parentNote;
        visit(stray, isNil(strayParent) ? "" : stringValue(strayParent.noteId), rootOrder++);
      }
    }
    return cards;
  }

  function snapshotId(cards) {
    var hash = 2166136261;
    for (var i = 0; i < cards.length; i += 1) {
      var card = cards[i];
      var value = card.noteId + "|" + card.parentId + "|" + card.order + "|" + stringValue(card.note.noteTitle) + "|" + stringValue(card.note.excerptText) + "|" + stringValue(card.note.notesText) + "|" + stringValue(card.note.modifiedDate);
      var comments = arrayValue(card.note.comments);
      for (var c = 0; c < comments.length; c += 1) value += "|" + stringValue(comments[c].text || comments[c].noteText || comments[c].html);
      for (var j = 0; j < value.length; j += 1) {
        hash ^= value.charCodeAt(j);
        hash = Math.imul(hash, 16777619);
      }
    }
    return cards.length + "-" + (hash >>> 0).toString(16);
  }

  function planId(snapshot, moves) {
    var value = snapshot + "|" + moves.map(function (m) { return m.noteId + ":" + m.parentNoteId + ":" + (m.beforeNoteId || ""); }).join("|");
    var hash = 2166136261;
    for (var i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return snapshot + "-" + (hash >>> 0).toString(16);
  }

  function libraryPage(args) {
    var topicId = stringValue(args.topicId);
    var cards = notebookCards(topicId);
    var snapshot = snapshotId(cards);
    if (args.snapshotId && args.snapshotId !== snapshot) fail("STALE_SNAPSHOT", "Notebook changed; restart pagination");
    var offset = Math.max(0, Math.floor(Number(args.offset || 0)));
    var limit = Math.max(1, Math.min(Number(args.limit || 30), 50));
    return {
      topicId: topicId,
      snapshotId: snapshot,
      totalCount: cards.length,
      nextOffset: offset + limit < cards.length ? offset + limit : null,
      cards: cards.slice(offset, offset + limit).map(function (item) {
        var raw = item.note;
        var comments = arrayValue(raw.comments);
        var excerpt = stringValue(raw.excerptText);
        var content = stringValue(raw.notesText);
        return {
          noteId: item.noteId, notebookId: topicId, parentNoteId: item.parentId,
          order: item.order, docMd5: stringValue(raw.docMd5), title: stringValue(raw.noteTitle),
          excerptText: excerpt.slice(0, 4000), notesText: content.slice(0, 4000),
          contentTruncated: excerpt.length > 4000 || content.length > 4000,
          commentCount: comments.length,
          comments: comments.slice(0, 10).map(function (comment) {
            var body = stringValue(comment.text || comment.noteText || comment.html);
            return { type: stringValue(comment.type || comment.commentType), text: body.slice(0, 1000), truncated: body.length > 1000 };
          }),
          commentsTruncated: comments.length > 10,
          summaryLinkIds: arrayValue(raw.summaryLinks).map(function (link) { return stringValue(link.noteId); }).filter(Boolean).slice(0, 100),
          summaryLinksTruncated: arrayValue(raw.summaryLinks).length > 100,
        };
      }),
    };
  }

  function requiredCard(noteId, topicId) {
    var note = Database.sharedInstance().getNoteById(noteId);
    if (!note) fail("NOTE_NOT_FOUND", "Note not found: " + noteId);
    if (stringValue(note.notebookId) !== topicId) fail("INVALID_ARGUMENT", "Card is outside the target notebook");
    return note;
  }

  function createFramework(args) {
    var topicId = stringValue(args.topicId);
    notebookById(topicId);
    var nodes = args.nodes || [];
    var parent = args.parentNoteId ? requiredCard(stringValue(args.parentNoteId), topicId) : null;
    var keys = Object.create(null);
    for (var i = 0; i < nodes.length; i += 1) {
      if (keys[nodes[i].key]) fail("INVALID_ARGUMENT", "Duplicate framework key");
      keys[nodes[i].key] = i;
      if (!stringValue(nodes[i].title).trim()) fail("INVALID_ARGUMENT", "Card title is required");
      if (nodes[i].parentKey && (!Object.prototype.hasOwnProperty.call(keys, nodes[i].parentKey) || keys[nodes[i].parentKey] === i)) fail("INVALID_ARGUMENT", "Parent must precede its child");
    }
    var created = Object.create(null);
    var result = [];
    UndoManager.sharedInstance().undoGrouping("Agent 创建知识框架", topicId, function () {
      for (var j = 0; j < nodes.length; j += 1) {
        var item = nodes[j];
        var note = Database.sharedInstance().createNoteWithTitleTopicid(stringValue(item.title).trim(), topicId);
        if (!note) fail("RPC_FAILURE", "MarginNote did not create the card");
        var owner = item.parentKey ? created[item.parentKey] : parent;
        if (owner) owner.addChild(note);
        if (item.body) note.appendMarkdownComment(stringValue(item.body));
        created[item.key] = note;
        result.push({ key: item.key, noteId: stringValue(note.noteId), parentNoteId: owner ? stringValue(owner.noteId) : "", title: stringValue(note.noteTitle) });
      }
    });
    refresh(topicId);
    for (var k = 0; k < result.length; k += 1) {
      var persisted = requiredCard(result[k].noteId, topicId);
      result[k].verified = stringValue(persisted.noteTitle) === result[k].title &&
        stringValue(persisted.parentNote && persisted.parentNote.noteId) === result[k].parentNoteId;
    }
    return { topicId: topicId, cards: result, allVerified: result.every(function (item) { return item.verified; }) };
  }

  function promoteExcerptToTitle(args) {
    var note = Database.sharedInstance().getNoteById(stringValue(args.noteId));
    if (!note) fail("NOTE_NOT_FOUND", "Note not found: " + stringValue(args.noteId));
    var source = stringValue(note.excerptText).trim();
    if (!source || source !== args.expectedExcerptText) fail("STALE_SNAPSHOT", "Card text changed or is empty");
    var title = source.slice(0, 500);
    var topicId = stringValue(note.notebookId);
    UndoManager.sharedInstance().undoGrouping("Agent 摘录转标题", topicId, function () { note.noteTitle = title; });
    refresh(topicId);
    return { noteId: stringValue(note.noteId), title: stringValue(Database.sharedInstance().getNoteById(stringValue(note.noteId)).noteTitle), excerptText: stringValue(note.excerptText) };
  }

  function reorganization(args, apply) {
    var topicId = stringValue(args.topicId);
    var cards = notebookCards(topicId);
    var snapshot = snapshotId(cards);
    if (apply && snapshot !== args.expectedSnapshotId) fail("STALE_SNAPSHOT", "Notebook changed since preview");
    var byId = Object.create(null);
    var parentOf = Object.create(null);
    for (var i = 0; i < cards.length; i += 1) {
      byId[cards[i].noteId] = cards[i].note;
      parentOf[cards[i].noteId] = cards[i].parentId;
    }
    var moves = args.moves || [];
    var plannedId = planId(snapshot, moves);
    if (apply && plannedId !== args.expectedPlanId) fail("INVALID_ARGUMENT", "Move plan differs from preview");
    var changed = Object.create(null);
    for (var j = 0; j < moves.length; j += 1) {
      var move = moves[j];
      if (!byId[move.noteId] || (move.parentNoteId && !byId[move.parentNoteId]) || move.noteId === move.parentNoteId || changed[move.noteId]) fail("INVALID_ARGUMENT", "Invalid or duplicate move");
      if (move.beforeNoteId && (!move.parentNoteId || !byId[move.beforeNoteId] || move.beforeNoteId === move.noteId)) fail("INVALID_ARGUMENT", "Invalid before card");
      changed[move.noteId] = true;
      parentOf[move.noteId] = move.parentNoteId || "";
    }
    for (var k = 0; k < moves.length; k += 1) {
      var cursor = moves[k].parentNoteId || "";
      var walked = Object.create(null);
      while (cursor) {
        if (cursor === moves[k].noteId || walked[cursor]) fail("INVALID_ARGUMENT", "Move would create a cycle");
        walked[cursor] = true;
        cursor = parentOf[cursor];
      }
      if (moves[k].beforeNoteId && parentOf[moves[k].beforeNoteId] !== moves[k].parentNoteId) fail("INVALID_ARGUMENT", "before card must be a sibling in the planned structure");
      if (moves[k].beforeNoteId && changed[moves[k].beforeNoteId]) fail("INVALID_ARGUMENT", "before card cannot also be moved in the same batch");
    }
    var plan = moves.map(function (move) { return { noteId: move.noteId, fromParentNoteId: stringValue(byId[move.noteId].parentNote && byId[move.noteId].parentNote.noteId), toParentNoteId: move.parentNoteId || "", beforeNoteId: move.beforeNoteId || "", title: stringValue(byId[move.noteId].noteTitle) }; });
    if (!apply) return { topicId: topicId, snapshotId: snapshot, planId: plannedId, moves: plan, count: plan.length };
    UndoManager.sharedInstance().undoGrouping("Agent 重组脑图", topicId, function () {
      for (var m = 0; m < moves.length; m += 1) {
        var target = byId[moves[m].parentNoteId];
        if (!target) byId[moves[m].noteId].removeFromParent();
        else if (moves[m].beforeNoteId) target.insertChildBefore(byId[moves[m].noteId], byId[moves[m].beforeNoteId]);
        else target.addChild(byId[moves[m].noteId]);
      }
    });
    refresh(topicId);
    for (var n = 0; n < plan.length; n += 1) {
      var updated = requiredCard(plan[n].noteId, topicId);
      var siblings = plan[n].toParentNoteId ? arrayValue(byId[plan[n].toParentNoteId].childNotes) : [];
      var ownIndex = siblings.map(function (item) { return stringValue(item.noteId); }).indexOf(plan[n].noteId);
      var beforeIndex = plan[n].beforeNoteId ? siblings.map(function (item) { return stringValue(item.noteId); }).indexOf(plan[n].beforeNoteId) : -1;
      var laterAppend = false;
      for (var q = n + 1; q < plan.length; q += 1) {
        if (plan[q].toParentNoteId === plan[n].toParentNoteId && !plan[q].beforeNoteId) laterAppend = true;
      }
      plan[n].verified = stringValue(updated.parentNote && updated.parentNote.noteId) === plan[n].toParentNoteId &&
        (plan[n].toParentNoteId ? ownIndex >= 0 && (plan[n].beforeNoteId ? beforeIndex === ownIndex + 1 : (laterAppend || ownIndex === siblings.length - 1)) :
          notebookCards(topicId).some(function (item) { return item.noteId === plan[n].noteId && !item.parentId; }));
    }
    return { topicId: topicId, moves: plan, allVerified: plan.every(function (item) { return item.verified; }) };
  }

  function searchNotes(addon, args) {
    var manager = Application.sharedInstance().searchManager;
    if (!manager) throw new Error("SearchManager is unavailable");
    var query = stringValue(args.query).trim();
    if (!query) throw new Error("query is required");
    var scope = stringValue(args.scope, "topic").toLowerCase();
    var limit = Math.max(1, Math.min(Number(args.limit || 30), 100));
    var topicId = stringValue(args.topicId) || currentTopicId(addon) || null;
    var results;
    if (scope === "page") {
      results = manager.searchPage(query, Boolean(args.beginsWith), limit);
    } else {
      if (scope === "all") topicId = null;
      results = manager.searchText(
        query,
        Boolean(args.titleOnly),
        topicId,
        Boolean(args.beginsWith),
        limit,
      );
    }
    return arrayValue(results)
      .slice(0, limit)
      .map(normalizeSearchItem)
      .filter(function (item) {
        return item !== null;
      });
  }

  function getNote(args) {
    var note = Database.sharedInstance().getNoteById(stringValue(args.noteId));
    if (!note) throw new Error("Note not found: " + stringValue(args.noteId));
    return serializeNote(note, Boolean(args.includeChildren));
  }

  function createNote(addon, args) {
    var title = stringValue(args.title).trim();
    if (!title) throw new Error("title is required");
    var topicId = stringValue(args.topicId) || currentTopicId(addon);
    if (!topicId) throw new Error("No target notebook is available");
    notebookById(topicId);
    var parent = args.parentNoteId ? requiredCard(stringValue(args.parentNoteId), topicId) : null;
    var created = null;
    UndoManager.sharedInstance().undoGrouping("Agent 创建笔记", topicId, function () {
      created = Database.sharedInstance().createNoteWithTitleTopicid(title, topicId);
      if (!created) fail("RPC_FAILURE", "MarginNote did not create the card");
      if (parent) parent.addChild(created);
      if (args.comment) {
        if (args.commentFormat === "markdown") created.appendMarkdownComment(stringValue(args.comment));
        else created.appendTextComment(stringValue(args.comment));
      }
    });
    refresh(topicId);
    return serializeNote(requiredCard(stringValue(created.noteId), topicId), false);
  }

  function updateNote(args) {
    var note = Database.sharedInstance().getNoteById(stringValue(args.noteId));
    if (!note) throw new Error("Note not found: " + stringValue(args.noteId));
    var hasChange =
      typeof args.title !== "undefined" ||
      typeof args.excerptText !== "undefined" ||
      typeof args.colorIndex !== "undefined";
    if (!hasChange) throw new Error("No fields to update");
    var topicId = stringValue(note.notebookId);
    UndoManager.sharedInstance().undoGrouping("Agent 修改笔记", topicId, function () {
      if (typeof args.title !== "undefined") note.noteTitle = stringValue(args.title);
      if (typeof args.excerptText !== "undefined") note.excerptText = stringValue(args.excerptText);
      if (typeof args.colorIndex !== "undefined") note.colorIndex = Number(args.colorIndex);
    });
    refresh(topicId);
    return serializeNote(note, false);
  }

  function appendComment(args) {
    var note = Database.sharedInstance().getNoteById(stringValue(args.noteId));
    if (!note) throw new Error("Note not found: " + stringValue(args.noteId));
    var text = stringValue(args.text);
    if (!text) throw new Error("text is required");
    var topicId = stringValue(note.notebookId);
    UndoManager.sharedInstance().undoGrouping("Agent 追加评论", topicId, function () {
      if (args.format === "markdown") note.appendMarkdownComment(text);
      else note.appendTextComment(text);
    });
    refresh(topicId);
    return serializeNote(requiredCard(stringValue(note.noteId), topicId), false);
  }

  function focusNote(addon, args) {
    var study = studyController(addon);
    if (!study) throw new Error("No active study window");
    var noteId = stringValue(args.noteId);
    if (!Database.sharedInstance().getNoteById(noteId)) throw new Error("Note not found: " + noteId);
    if (args.target === "document") study.focusNoteInDocumentById(noteId);
    else study.focusNoteInMindMapById(noteId);
    return { focused: true, noteId: noteId, target: args.target || "mindmap" };
  }

  function execute(addon, tool, args) {
    args = args || {};
    switch (tool) {
      case "get_context":
        return getContext(addon);
      case "get_selection":
        return getSelection(addon, args);
      case "read_pdf":
        return readPdf(addon, args);
      case "get_current_pdf":
        return getCurrentPdf(addon);
      case "list_notebooks":
        return listNotebooks(args);
      case "get_library_page":
        return libraryPage(args);
      case "search_notes":
        return searchNotes(addon, args);
      case "get_note":
        return getNote(args);
      case "create_note":
        return createNote(addon, args);
      case "create_card":
        return createNote(addon, args);
      case "create_framework":
        return createFramework(args);
      case "promote_excerpt_to_title":
        return promoteExcerptToTitle(args);
      case "preview_reorganization":
        return reorganization(args, false);
      case "apply_reorganization":
        return reorganization(args, true);
      case "update_note":
        return updateNote(args);
      case "append_comment":
        return appendComment(args);
      case "focus_note":
        return focusNote(addon, args);
      default:
        throw new Error("Unknown MarginNote tool: " + tool);
    }
  }

  return { execute: execute };
})();
