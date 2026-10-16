import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/scraper/classify.js';

test('short English keywords never match inside unrelated words', () => {
  for (const title of ['Rain falls across the plain', 'A happy trail awaits', 'Chair repairs begin', 'Margaret paints a portrait']) {
    const result = classify(title, '');
    assert.equal(result.scores.AI, 0, title);
    assert.equal(result.scores.Tech, 0, title);
  }
});

test('representative headlines cover all categories and common plural forms', () => {
  const fixtures = [
    ['OpenAI launches an AI model', 'AI'],
    ['Generative-AI and machine-learning research', 'AI'],
    ['LLMs improve inference', 'AI'],
    ['Stocks and bonds rise as inflation slows', 'Finance'],
    ['Voters elect senators in national elections', 'Politics'],
    ['Smartphones gain faster processors and chips', 'Tech'],
    ['Retail companies announce layoffs', 'Business'],
    ['Actors win film awards at the cinema festival', 'Entertainment'],
    ['Rain falls across the plain', 'Other'],
    ['人工智能技术与大模型', 'AI'],
  ];
  for (const [title, expected] of fixtures) assert.equal(classify(title, '').category, expected, title);
});

test('phrases accept punctuation and Unicode width while title hits keep double weight', () => {
  assert.ok(classify('ＭＡＣＨＩＮＥ—ＬＥＡＲＮＩＮＧ', '').scores.AI > 0);
  assert.equal(classify('AI', '').scores.AI, 2);
  assert.equal(classify('', 'AI').scores.AI, 1);
  assert.equal(classify('AI', '').scores.Politics, 0);
});
