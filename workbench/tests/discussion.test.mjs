import test from 'node:test';
import assert from 'node:assert/strict';
import {deletionPrompt, discussionPrompt, moreSuggestionsPrompt, onboardingPrompt, reviewPrompt} from '../src/lib/client/discussion.js';

test('同名文件的操作提示以識別碼區分目標', () => {
  const first = {title: '同名報告', id: 'a7c6a159-0f6f-4324-981e-abf77c7e9aa1'};
  const second = {title: first.title, id: 'e874bde4-4755-4463-a82d-c8923a90f3f1'};
  const comment = {id: '#001', page: 1, anchorText: '結論', text: '依據尚未說明'};
  for (const prompt of [onboardingPrompt, reviewPrompt, deletionPrompt, moreSuggestionsPrompt, lesson => discussionPrompt(lesson, comment)]) {
    const firstMessage = prompt(first);
    const secondMessage = prompt(second);
    assert.ok(firstMessage.includes(first.id));
    assert.ok(secondMessage.includes(second.id));
    assert.equal(firstMessage.includes(second.id), false);
    assert.equal(secondMessage.includes(first.id), false);
  }
});
