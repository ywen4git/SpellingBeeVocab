import { describe, expect, it } from 'vitest';
import { diffDefinitions } from '../definitionDiff';

describe('diffDefinitions', () => {
  it('returns everything unchanged when the texts are identical', () => {
    const text = '(noun) A fungus.\n\n(verb) To forage.';
    expect(diffDefinitions(text, text)).toEqual([
      { type: 'unchanged', text: '(noun) A fungus.' },
      { type: 'unchanged', text: '(verb) To forage.' },
    ]);
  });

  it('marks a sense present only in the new text as added', () => {
    const result = diffDefinitions('(noun) A fungus.', '(noun) A fungus.\n\n(verb) To forage.');
    expect(result).toEqual([
      { type: 'unchanged', text: '(noun) A fungus.' },
      { type: 'added', text: '(verb) To forage.' },
    ]);
  });

  it('marks a sense present only in the old text as removed', () => {
    const result = diffDefinitions('(noun) A fungus.\n\n(verb) To forage.', '(noun) A fungus.');
    expect(result).toEqual([
      { type: 'unchanged', text: '(noun) A fungus.' },
      { type: 'removed', text: '(verb) To forage.' },
    ]);
  });

  it('diffs a fully replaced single-sense definition as removed then added', () => {
    const result = diffDefinitions('(noun) A fungus.', '(noun) A completely different meaning.');
    expect(result).toEqual([
      { type: 'removed', text: '(noun) A fungus.' },
      { type: 'added', text: '(noun) A completely different meaning.' },
    ]);
  });

  it('treats an empty old text as everything added', () => {
    expect(diffDefinitions('', '(noun) A fungus.')).toEqual([{ type: 'added', text: '(noun) A fungus.' }]);
  });

  it('treats an empty new text as everything removed', () => {
    expect(diffDefinitions('(noun) A fungus.', '')).toEqual([{ type: 'removed', text: '(noun) A fungus.' }]);
  });
});
