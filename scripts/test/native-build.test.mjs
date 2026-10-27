import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const run = promisify(execFile);
const projectDir = fileURLToPath(new URL('../..', import.meta.url));

test('native helper build fails visibly on compiler errors and does not publish an archive', { skip: process.platform !== 'darwin' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mn-native-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts');
  await cp(path.join(projectDir, 'scripts'), scripts, { recursive: true });
  await cp(path.join(projectDir, 'addon'), path.join(root, 'addon'), { recursive: true });
  await writeFile(path.join(scripts, 'image-ocr.m'), 'intentional invalid Objective-C source;\n');
  const stateDir = path.join(root, 'state');
  const env = { ...process.env, MN_AGENT_STATE_DIR: stateDir, MN_AGENT_HELPER_DIR: path.join(stateDir, 'bin'),
    MN_AGENT_ADDON_ARCHIVE: path.join(stateDir, 'addon.mnaddon'), MN_AGENT_BUILD_DIR: path.join(stateDir, 'build') };
  await assert.rejects(run(process.execPath, [path.join(scripts, 'build-addon.mjs')], { env }), error => {
    assert.notEqual(error.code, 0);
    assert.match(error.stderr, /error:/);
    return true;
  });
  await assert.rejects(stat(env.MN_AGENT_ADDON_ARCHIVE), { code: 'ENOENT' });
  assert.deepEqual(await readdir(env.MN_AGENT_HELPER_DIR), [], 'failed compiler outputs must be removed');
});

test('manual Host OCR resolves helpers from the same state directory as the build', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mn-ocr-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helperDir = path.join(root, 'bin');
  await mkdir(helperDir);
  await writeFile(path.join(helperDir, 'image-ocr'), '#!/bin/sh\nprintf \'{"ocr_text":"resolved helper","vision_error":""}\\n\'\n', { mode: 0o700 });
  const env = { ...process.env, MN_AGENT_STATE_DIR: root };
  delete env.MN_AGENT_HELPER_DIR;
  const moduleUrl = new URL('../../mcp/src/note-media.mjs', import.meta.url).href;
  const code = `const { renderedNoteImage } = await import(${JSON.stringify(moduleUrl)});
    const result = await renderedNoteImage({ image_base64: Buffer.alloc(1200).toString('base64'), image_mime_type: 'image/png' });
    console.log(JSON.stringify({ text: result.ocr_text, engine: result.ocr_engine }));`;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', code], { env });
  assert.deepEqual(JSON.parse(stdout), { text: 'resolved helper', engine: 'apple_vision' });
});
